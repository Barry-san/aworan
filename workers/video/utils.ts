import { probeVideo } from "@/lib/probe"
import { RENDITIONS, type Rendition, ladderFor } from "@/lib/ffmpeg"

export { ladderFor }

export async function detectHasAudio(inputPath: string, signal?: AbortSignal): Promise<boolean> {
  return (await probeVideo(inputPath, signal)).hasAudio
}

export function buildFiltersAndArgs({
	inputPath,
	outputDir,
	heights,
	hasAudio = true,
}: {
	inputPath: string
	outputDir: string
	heights: number[]
	hasAudio?: boolean
}): { filterComplex: string; argv: string[] } {
	const rends = heights.map((height) => {
		const rendition = RENDITIONS[height]
		if (!rendition) throw new Error(`Unsupported rendition height: ${height}p`)
		return rendition
	})
	const n = rends.length

	const labels = rends.map((_, i) => `[v${i}]`)
	const split = `[0:v]split=${n}${labels.join("")}`
	const scales = rends
		.map((rendition, i) => `[v${i}]scale=-2:${rendition.height}[v${i}out]`)
		.join(";")
	const filterComplex = `${split};${scales}`

	const argv: string[] = [
		"ffmpeg",
		"-nostdin",
		"-protocol_whitelist",
		"file,pipe",
		"-i",
		inputPath,
		"-filter_complex",
		filterComplex,
	]

	rends.forEach((rendition, i) => {
		argv.push(
			"-map",
			`[v${i}out]`,
			`-c:v:${i}`,
			"libx264",
			`-b:v:${i}`,
			rendition.videoBitrate,
			`-maxrate:v:${i}`,
			rendition.maxrate,
			`-bufsize:v:${i}`,
			rendition.bufsize,
		)
	})

	if (hasAudio) {
		for (let i = 0; i < n; i++) argv.push("-map", "a:0")
		argv.push("-c:a", "aac", "-b:a", "128k")
	}

	argv.push("-g", "48", "-keyint_min", "48", "-sc_threshold", "0")

	const varStreamMap = rends
		.map((rendition, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`) + `,name:${rendition.height}p`)
		.join(" ")

	argv.push(
		"-f",
		"hls",
		"-hls_time",
		"6",
		"-hls_playlist_type",
		"vod",
		"-hls_flags",
		"independent_segments",
		"-hls_segment_filename",
		`${outputDir}/%v/segment_%03d.ts`,
		"-master_pl_name",
		"master.m3u8",
		"-var_stream_map",
		varStreamMap,
		`${outputDir}/%v/playlist.m3u8`,
	)

	return { filterComplex, argv }
}

export function buildTranscodeForSource({
	inputPath,
	outputDir,
	sourceHeight,
}: {
	inputPath: string
	outputDir: string
	sourceHeight: number
}) {
	return buildFiltersAndArgs({ inputPath, outputDir, heights: ladderFor(sourceHeight) })
}
