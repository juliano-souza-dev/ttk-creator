import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DownloadProgress,
  MediaAsset,
  Project,
  YoutubeInspection,
} from "../shared/types";

export const isDesktopRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type GlobalSound = { id: string; name: string; fileName: string };

export const desktopApi = {
  listGlobalSounds: () => invoke<GlobalSound[]>("list_global_sounds"),
  importGlobalSound: (sourcePath: string, name: string) => invoke<GlobalSound>("import_global_sound", { sourcePath, name }),
  getGlobalSoundPath: (soundId: string) => invoke<string>("get_global_sound_path", { soundId }),
  deleteGlobalSound: (soundId: string) => invoke<void>("delete_global_sound", { soundId }),
  listProjects: () => invoke<Project[]>("list_projects"),

  openProject: (projectId: string) =>
    invoke<Project>("open_project", { projectId }),

  createProject: (name: string) =>
    invoke<Project>("create_project", { name }),

  listProjectAssets: (projectId: string) =>
    invoke<MediaAsset[]>("list_project_assets", { projectId }),

  getAssetPath: (projectId: string, assetId: string) =>
    invoke<string>("get_project_asset_path", { projectId, assetId }),

  importMediaFiles: (projectId: string, paths: string[]) =>
    invoke<MediaAsset[]>("import_media_files", { projectId, paths }),

  inspectYoutube: (url: string) =>
    invoke<YoutubeInspection>("inspect_youtube", { url }),

  downloadYoutube: (projectId: string, url: string, maxHeight: number) =>
    invoke<MediaAsset>("download_youtube", { projectId, url, maxHeight }),

  checkFfmpeg: () => invoke<string>("check_ffmpeg"),

  exportTimeline: (request: { projectId: string; destination: string; clips: Array<{ id: string; assetId: string; kind: "video" | "audio" | "image"; sourceStartMs: number; sourceEndMs: number; timelineStartMs: number; volume: number; muted?: boolean; transitionType?: "fade-black" | "fade-white" | "flash"; transitionMs?: number }>; motion: Array<{ text: string; startMs: number; endMs: number; durationMs?: number; preset?: "pop" | "slide" | "zoom" | "typewriter" | "impact" | "composition"; color: string; fontSize: number; x: number; y: number; fontFamily?: string; fontWeight?: number; textAlign?: "left" | "center" | "right"; isCaption?: boolean; lucideIconPng?: string; lucideIconAnchor?: "left" | "right" | "top" | "bottom"; lucideIconSize?: number; x?: number; y?: number; soundId?: string; soundVolume?: number }>; soundEffects?: Array<{ soundId: string; timelineStartMs: number; volume: number }> }) =>
    invoke<string>("export_timeline", {
      request: {
        ...request,
        // Rust receives timeline timestamps as u64. Timeline interactions can
        // produce fractional milliseconds, so normalize them at the IPC boundary.
        clips: request.clips.map((clip) => ({
          ...clip,
          sourceStartMs: Math.max(0, Math.round(clip.sourceStartMs)),
          sourceEndMs: Math.max(0, Math.round(clip.sourceEndMs)),
          timelineStartMs: Math.max(0, Math.round(clip.timelineStartMs)),
        })),
        soundEffects: (request.soundEffects ?? []).map((item) => ({ ...item, timelineStartMs: Math.max(0, Math.round(item.timelineStartMs)), volume: Math.max(0, Math.min(100, item.volume)) })),
        motion: request.motion.map((item) => ({
          ...item,
          startMs: Math.max(0, Math.round(item.startMs)),
          endMs: Math.max(0, Math.round(item.endMs)),
          durationMs: Math.max(1, Math.round(item.durationMs ?? (item.endMs - item.startMs))),
          fontSize: Math.max(1, Math.round(item.fontSize)),
        })),
      },
    }),

  subscribeToYoutubeProgress: (
    onProgress: (progress: DownloadProgress) => void,
  ) =>
    listen<DownloadProgress>("youtube-download-progress", (event) =>
      onProgress(event.payload),
    ),
};
