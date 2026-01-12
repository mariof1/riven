from sqla_wrapper import SQLAlchemy
from program.settings import settings_manager


db_host = str(settings_manager.settings.database.host)

engine_options: dict[str, object] = {
    "pool_size": 25,  # Prom: Set to 1 when debugging sql queries
    "max_overflow": 25,  # Prom: Set to 0 when debugging sql queries
    "pool_pre_ping": True,  # Prom: Set to False when debugging sql queries
    "pool_recycle": 1800,  # Prom: Set to -1 when debugging sql queries
    "echo": False,  # Prom: Set to true when debugging sql queries
}

# Some user databases are configured with SQL_ASCII / mis-set client encoding.
# Ensure psycopg2 encodes outgoing strings as UTF-8 to avoid flush failures on
# non-ASCII titles/filenames (e.g. U+A789 "꞉").
if db_host.startswith("postgres"):
    engine_options["connect_args"] = {
        "options": "-c client_encoding=UTF8",
    }

db = SQLAlchemy(db_host, engine_options=engine_options)
