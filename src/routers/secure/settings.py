from copy import copy
import os
from typing import Annotated, Any, cast

from fastapi import APIRouter, Body, HTTPException, Path, Query
from pydantic import TypeAdapter, ValidationError

from program.settings import settings_manager
from program.settings.models import AppModel

from ..models.shared import MessageResponse

router = APIRouter(
    prefix="/settings",
    tags=["settings"],
    responses={404: {"description": "Not found"}},
)


@router.get(
    "/schema",
    operation_id="get_settings_schema",
    response_model=dict[str, Any],
)
async def get_settings_schema() -> dict[str, Any]:
    """Get the JSON schema for the settings."""

    schema = settings_manager.settings.model_json_schema()

    # Monolith dev container: filesystem mount path is controlled by the container
    # and should not be editable from the UI.
    if os.environ.get("RIVEN_MONOLITH", "false").lower() == "true":
        forced_mount_path = os.environ.get("RIVEN_FILESYSTEM_MOUNT_PATH")
        if forced_mount_path:
            _lock_filesystem_mount_path_in_schema(schema, forced_mount_path)

    return schema


def _lock_filesystem_mount_path_in_schema(schema: dict[str, Any], mount_path: str) -> None:
    """Mutate JSON schema to make filesystem.mount_path read-only and constant."""

    props = schema.get("properties")
    if not isinstance(props, dict):
        return

    filesystem_schema = props.get("filesystem")
    if not isinstance(filesystem_schema, dict):
        return

    # Pydantic usually places nested models in $defs and references them.
    target_schema: Any = filesystem_schema
    ref = filesystem_schema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        defs = schema.get("$defs")
        if isinstance(defs, dict):
            target_schema = defs.get(ref.split("/")[-1], target_schema)

    if not isinstance(target_schema, dict):
        return

    fs_props = target_schema.get("properties")
    if not isinstance(fs_props, dict):
        return

    mount_path_schema = fs_props.get("mount_path")
    if not isinstance(mount_path_schema, dict):
        return

    mount_path_schema["readOnly"] = True
    mount_path_schema["const"] = mount_path
    mount_path_schema["default"] = mount_path


@router.get(
    "/schema/keys",
    operation_id="get_settings_schema_for_keys",
    response_model=dict[str, Any],
)
async def get_settings_schema_for_keys(
    keys: Annotated[
        str,
        Query(
            description="Comma-separated list of top-level keys to get schema for (e.g., 'version,api_key,updaters')",
            min_length=1,
        ),
    ],
    title: Annotated[
        str,
        Query(
            description="Title of the schema",
        ),
    ] = "FilteredSettings",
) -> dict[str, Any]:
    model_fields = AppModel.model_fields
    requested_keys = [k.strip() for k in keys.split(",") if k.strip()]

    if not requested_keys:
        raise HTTPException(
            status_code=400,
            detail="At least one key must be provided",
        )

    valid_keys = set(model_fields.keys())
    invalid_keys = [k for k in requested_keys if k not in valid_keys]
    if invalid_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid keys: {', '.join(invalid_keys)}. Valid keys are: {', '.join(sorted(valid_keys))}",
        )

    all_defs: dict[str, Any] = {}
    properties: dict[str, Any] = {}
    required: list[str] = []

    for key in requested_keys:
        field_info = model_fields[key]
        adapter: TypeAdapter[Any] = TypeAdapter(field_info.annotation)
        field_schema = adapter.json_schema(ref_template="#/$defs/{model}")

        if "$defs" in field_schema:
            all_defs.update(field_schema.pop("$defs"))

        properties[key] = field_schema

        if field_info.is_required():
            required.append(key)

    filtered_schema: dict[str, Any] = {
        "properties": properties,
        "required": required,
        "title": title,
        "type": "object",
    }

    if all_defs:
        filtered_schema["$defs"] = all_defs

    return filtered_schema


@router.get(
    "/load",
    operation_id="load_settings",
    response_model=MessageResponse,
)
async def load_settings() -> MessageResponse:
    settings_manager.load()

    return MessageResponse(message="Settings loaded!")


@router.post(
    "/save",
    operation_id="save_settings",
    response_model=MessageResponse,
)
async def save_settings() -> MessageResponse:
    settings_manager.save()

    return MessageResponse(message="Settings saved!")


@router.get(
    "/get/all",
    operation_id="get_all_settings",
    response_model=AppModel,
)
async def get_all_settings() -> AppModel:
    settings = copy(settings_manager.settings)

    # In monolith mode, the mount path is controlled by the container.
    forced_mount_path = os.environ.get("RIVEN_FILESYSTEM_MOUNT_PATH")
    monolith = os.environ.get("RIVEN_MONOLITH", "false").lower() == "true"
    if monolith and forced_mount_path:
        settings.filesystem.mount_path = forced_mount_path

    return settings


@router.get(
    "/get/{paths}",
    operation_id="get_settings",
    response_model=dict[str, Any],
)
async def get_settings(
    paths: Annotated[
        str,
        Path(
            description="Comma-separated list of settings paths",
            min_length=1,
        ),
    ],
) -> dict[str, Any]:
    current_settings = settings_manager.settings.model_dump()

    # In monolith mode, the mount path is controlled by the container.
    forced_mount_path = os.environ.get("RIVEN_FILESYSTEM_MOUNT_PATH")
    monolith = os.environ.get("RIVEN_MONOLITH", "false").lower() == "true"
    if monolith and forced_mount_path:
        current_settings.setdefault("filesystem", {})["mount_path"] = forced_mount_path

    data = dict[str, Any]()

    for path in paths.split(","):
        keys = path.split(".")
        current_obj = current_settings

        for k in keys:
            if k not in current_obj:
                continue

            current_obj = current_obj[k]

        data[path] = current_obj

    return data


@router.post(
    "/set/all",
    operation_id="set_all_settings",
    response_model=MessageResponse,
)
async def set_all_settings(
    new_settings: Annotated[
        dict[str, Any],
        Body(description="New settings to apply"),
    ],
) -> MessageResponse:
    current_settings = settings_manager.settings.model_dump()

    # In monolith mode, the mount path is controlled by the container.
    forced_mount_path = os.environ.get("RIVEN_FILESYSTEM_MOUNT_PATH")
    monolith = os.environ.get("RIVEN_MONOLITH", "false").lower() == "true"

    def update_settings(current_obj: dict[str, Any], new_obj: dict[str, Any]):
        for key, value in new_obj.items():
            if isinstance(value, dict) and key in current_obj:
                update_settings(current_obj[key], cast(dict[str, Any], value))
            else:
                current_obj[key] = value

    update_settings(current_settings, new_settings)

    if monolith and forced_mount_path:
        current_settings.setdefault("filesystem", {})["mount_path"] = forced_mount_path

    # Validate and save the updated settings
    try:
        updated_settings = settings_manager.settings.model_validate(current_settings)
        settings_manager.load(settings_dict=updated_settings.model_dump())
        settings_manager.save()  # Ensure the changes are persisted
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    return MessageResponse(message="All settings updated successfully!")


@router.post(
    "/set/{paths}",
    operation_id="set_settings",
    response_model=MessageResponse,
)
async def set_settings(
    paths: Annotated[
        str,
        Path(
            description="Comma-separated list of settings paths to update",
            min_length=1,
        ),
    ],
    values: Annotated[
        dict[str, Any],
        Body(description="Dictionary mapping paths to their new values"),
    ],
) -> MessageResponse:
    current_settings = settings_manager.settings.model_dump()

    forced_mount_path = os.environ.get("RIVEN_FILESYSTEM_MOUNT_PATH")
    monolith = os.environ.get("RIVEN_MONOLITH", "false").lower() == "true"
    requested_paths = [p.strip() for p in paths.split(",") if p.strip()]

    missing_values = [p for p in requested_paths if p not in values]
    if missing_values:
        raise HTTPException(
            status_code=400,
            detail=f"Missing values for paths: {', '.join(missing_values)}",
        )

    for path in requested_paths:
        keys = path.split(".")
        current_obj: Any = current_settings

        # Navigate to the parent object
        for k in keys[:-1]:
            if not isinstance(current_obj, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot traverse path '{path}': intermediate value is not an object.",
                )
            if k not in current_obj:
                raise HTTPException(
                    status_code=400,
                    detail=f"Path '{path}' does not exist.",
                )
            current_obj = cast(Any, current_obj[k])

        if not isinstance(current_obj, dict):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot set value at '{path}': parent is not an object.",
            )
        if keys[-1] not in current_obj:
            raise HTTPException(
                status_code=400,
                detail=f"Key '{keys[-1]}' does not exist in path '{'.'.join(keys[:-1]) or 'root'}'.",
            )
        current_obj[keys[-1]] = values[path]

    if monolith and forced_mount_path:
        current_settings.setdefault("filesystem", {})["mount_path"] = forced_mount_path

    try:
        updated_settings = settings_manager.settings.__class__(**current_settings)
        settings_manager.load(settings_dict=updated_settings.model_dump())
        settings_manager.save()
    except ValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to update settings: {str(e)}",
        ) from e

    return MessageResponse(message="Settings updated successfully.")
