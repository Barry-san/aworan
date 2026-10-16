export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
// Allow multipart boundaries/headers in addition to the file itself.
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

function milliseconds(name: string, fallback: number) {
	const value =
		process.env[name] === undefined ? fallback : Number(process.env[name]);
	if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
		throw new Error(`${name} must be a positive timeout in milliseconds`);
	}
	return value;
}

export const PROBE_TIMEOUT_MS = milliseconds("PROBE_TIMEOUT_MS", 30_000);
export const THUMBNAIL_TIMEOUT_MS = milliseconds(
	"THUMBNAIL_TIMEOUT_MS",
	15_000,
);
export const TRANSCODE_TIMEOUT_MS = milliseconds(
	"TRANSCODE_TIMEOUT_MS",
	60 * 60 * 1000,
);
