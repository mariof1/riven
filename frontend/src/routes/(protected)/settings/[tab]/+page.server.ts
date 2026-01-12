import type { Actions, PageServerLoad } from "./$types";
import { error, fail, redirect } from "@sveltejs/kit";
import providers from "$lib/providers";
import type { InitialFormData } from "@sjsf/sveltekit";
import { createFormHandler } from "@sjsf/sveltekit/server";
import * as defaults from "$lib/components/settings/form-defaults";

type JsonSchema = Record<string, any>;

type TabConfig = {
    title: string;
    keys: string[];
};

const TAB_CONFIG: Record<string, TabConfig> = {
    general: {
        title: "General Settings",
        keys: [
            "api_key",
            "log_level",
            "enable_network_tracing",
            "enable_stream_tracing",
            "retry_interval",
            "tracemalloc"
        ]
    },
    filesystem: { title: "Filesystem", keys: ["filesystem"] },
    updaters: { title: "Updaters", keys: ["updaters"] },
    downloaders: { title: "Downloaders", keys: ["downloaders"] },
    content: { title: "Content", keys: ["content"] },
    scraping: { title: "Scraping", keys: ["scraping"] },
    indexer: { title: "Indexer", keys: ["indexer"] },
    ranking: { title: "Ranking", keys: ["ranking"] },
    notifications: { title: "Notifications", keys: ["notifications"] },
    post_processing: { title: "Post-processing", keys: ["post_processing"] },
    stream: { title: "Streaming", keys: ["stream"] },
    database: { title: "Database", keys: ["database"] },
    logging: { title: "Logging", keys: ["logging"] }
};

const getFullSchema = async (baseUrl: string, apiKey: string, fetchFn: typeof globalThis.fetch) => {
    const settingsSchema = await providers.riven.GET("/api/v1/settings/schema", {
        baseUrl,
        headers: {
            "x-api-key": apiKey
        },
        fetch: fetchFn
    });

    if (settingsSchema.error) {
        throw new Error("Failed to load settings schema");
    }

    return settingsSchema.data as JsonSchema;
};

const pickSchema = (schema: JsonSchema, keys: string[], title: string): JsonSchema => {
    const properties = (schema?.properties ?? {}) as Record<string, any>;
    const pickedProperties: Record<string, any> = {};

    for (const key of keys) {
        if (key in properties) {
            pickedProperties[key] = properties[key];
        }
    }

    const required = Array.isArray(schema?.required)
        ? (schema.required as string[]).filter((k) => keys.includes(k))
        : undefined;

    const out: JsonSchema = {
        type: "object",
        title,
        properties: pickedProperties
    };

    if (required && required.length > 0) {
        out.required = required;
    }

    if (schema?.$defs) {
        out.$defs = schema.$defs;
    }

    return out;
};

const pickInitialValue = (allSettings: Record<string, any>, keys: string[]) => {
    const initialValue: Record<string, any> = {};
    for (const key of keys) {
        if (key in allSettings) {
            initialValue[key] = allSettings[key];
        }
    }
    return initialValue;
};

export const load: PageServerLoad = async ({ fetch, locals, params }) => {
    const tab = params.tab;
    const config = TAB_CONFIG[tab];
    if (!config) {
        redirect(302, "/settings/general");
    }

    const [fullSchema, allSettings] = await Promise.all([
        getFullSchema(locals.backendUrl, locals.apiKey, fetch),
        providers.riven.GET("/api/v1/settings/get/all", {
            baseUrl: locals.backendUrl,
            headers: {
                "x-api-key": locals.apiKey
            },
            fetch
        })
    ]);

    if (allSettings.error) {
        error(500, "Failed to load settings");
    }

    return {
        tab,
        form: {
            schema: pickSchema(fullSchema, config.keys, config.title),
            initialValue: pickInitialValue(allSettings.data as Record<string, any>, config.keys)
        } satisfies InitialFormData
    };
};

export const actions = {
    default: async ({ request, fetch, locals, params }) => {
        const tab = params.tab;
        const config = TAB_CONFIG[tab];
        if (!config) {
            redirect(302, "/settings/general");
        }

        const fullSchema = await getFullSchema(locals.backendUrl, locals.apiKey, fetch);
        const schema = pickSchema(fullSchema, config.keys, config.title);

        const handleForm = createFormHandler<any, true>({
            ...defaults,
            // @ts-expect-error - schema type is valid
            schema,
            sendData: true
        });

        const [form] = await handleForm(request.signal, await request.formData());
        if (!form.isValid) {
            return fail(400, { form });
        }

        const res = await providers.riven.POST("/api/v1/settings/set/all", {
            body: form.data,
            baseUrl: locals.backendUrl,
            headers: {
                "x-api-key": locals.apiKey
            },
            fetch
        });

        if (res.error) {
            return fail(500, { form });
        }

        return { form };
    }
} satisfies Actions;
