// Services validate application configuration when imported. Supply test-only
// defaults without loading a developer's .env or replacing explicit settings.
process.env.DB_PORT ??= "5432";
process.env.DB_USER ??= "yt_test";
process.env.DB_PASSWORD ??= "yt_test";
process.env.DB_HOST ??= "127.0.0.1";
process.env.DB_NAME ??= "yt_test";
process.env.PAGE_LIMIT ??= "10";
