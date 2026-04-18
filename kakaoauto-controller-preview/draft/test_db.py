"""Database connection test for the Financial Trading System.

Uses the type-safe environment parser from config/env.py.
Run: python -m tests.unit.test_db
"""

import sys

from config.env import ENV


def test_connection() -> None:
    """Test PostgreSQL connection using configured environment variables."""
    import psycopg

    host = ENV.trading_db_host or "localhost"
    port = ENV.trading_db_port
    db_name = ENV.trading_db_name
    schema = ENV.trading_db_schema

    print(f"Attempting to connect to {host}:{port}/{db_name} (schema: {schema})...")

    params = ENV.get_db_params()
    options = f"-c search_path={schema}"

    try:
        with psycopg.connect(**params, options=options, connect_timeout=5) as conn:
            print("Successfully connected to the database!")
            with conn.cursor() as cur:
                cur.execute("SELECT version();")
                version = cur.fetchone()
                print(f"PostgreSQL version: {version[0]}")

                cur.execute(
                    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = %s;",
                    (schema,),
                )
                schema_exists = cur.fetchone()
                if schema_exists:
                    print(f"Schema '{schema}' exists.")
                else:
                    print(f"Schema '{schema}' does NOT exist.")
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)


if __name__ == "__main__":
    test_connection()
