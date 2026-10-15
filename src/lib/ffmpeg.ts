export type Rendition = {
	height: number;
	videoBitrate: string;
	maxrate: string;
	bufsize: string;
};

export const RENDITIONS: Record<number, Rendition> = {
	1080: {
		height: 1080,
		videoBitrate: "5000k",
		maxrate: "5500k",
		bufsize: "10000k",
	},
	720: {
		height: 720,
		videoBitrate: "2800k",
		maxrate: "3000k",
		bufsize: "5600k",
	},
	360: { height: 360, videoBitrate: "800k", maxrate: "856k", bufsize: "1200k" },
};

export function ladderFor(sourceHeight: number): number[] {
	if (sourceHeight >= 1080) return [1080, 720, 360];
	if (sourceHeight >= 720) return [720, 360];
	return [360];
}
