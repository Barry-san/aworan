import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// Never use a client filename as a storage path, including inside the unique directory.
export async function storeUpload(
	file: File,
	root = join(process.cwd(), "uploads"),
) {
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, "upload-"));
	try {
		const path = join(directory, "source");
		await writeFile(path, new Uint8Array(await file.arrayBuffer()), {
			flag: "wx",
		});
		return {
			path,
			discard: () => rm(directory, { recursive: true, force: true }),
		};
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

export async function discardOwnedSource(
	path: string,
	root = join(process.cwd(), "uploads"),
) {
	const local = relative(resolve(root), resolve(path));
	// Old jobs used shared filenames. Only remove directories produced by storeUpload.
	if (/^upload-[A-Za-z0-9]+\/source$/.test(local)) {
		await rm(resolve(root, local, ".."), { recursive: true, force: true });
	}
}
