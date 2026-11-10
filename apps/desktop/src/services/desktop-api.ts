import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { runTrackedTask } from "./task-center";
import type {
  DownloadProgress,
  MediaAsset,
  Project,
  YoutubeInspection,
} from "../shared/types";

export const isDesktopRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type GlobalSound = { id: string; name: string; fileName: string };
export type GroqSettings = { configured: boolean; model: string; maxChunkChars: number; maxCuesPerChunk: number; delayMs: number; targetLanguage: string };
export type TranslationCue = { id: string; text: string; contextBefore?: string; contextAfter?: string };
export type CueTranslation = { id: string; translation: string };
export type TranscriptWord = { text: string; startMs: number; endMs: number };
export type TranscriptCue = { id: string; text: string; startMs: number; endMs: number; words: TranscriptWord[] };
export type TranscriptResult = { engine: string; model: string; language?: string | null; durationMs: number; cues: TranscriptCue[] };
export type TranscriptionProgress = { projectId: string; stage: string; percent: number; completedChunks: number; totalChunks: number; message: string };

export const desktopApi = {
  getGroqSettings: () => invoke<GroqSettings>("get_groq_settings"),
  transcribeMedia: (projectId: string, assetId: string, mode: "auto" | "cloud" | "local", language: string, localModel: string) =>
    runTrackedTask("transcription", "Transcrição de mídia", () => invoke<TranscriptResult>("transcribe_media", { projectId, assetId, mode, language: language || null, localModel })),
  checkLocalAsr: () => invoke<boolean>("check_local_asr"),
  installLocalAsr: () => runTrackedTask("installation", "Instalação do suporte de transcrição local", () => invoke<string>("install_local_asr")),
  saveGroqSettings: (settings: { apiKey: string; model: string; maxChunkChars: number; maxCuesPerChunk: number; delayMs: number; targetLanguage: string }) =>
    invoke<GroqSettings>("save_groq_settings", settings),
  testGroqConnection: (model: string) => invoke<string>("test_groq_connection", { model }),
  translateGroqChunk: (model: string, targetLanguage: string, cues: TranslationCue[]) =>
    invoke<CueTranslation[]>("translate_groq_chunk", { model, targetLanguage, cues }),
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
    runTrackedTask("download", "Download de vídeo do YouTube", () => invoke<MediaAsset>("download_youtube", { projectId, url, maxHeight })),

  checkFfmpeg: () => invoke<string>("check_ffmpeg"),

  exportTimeline: (request: { projectId: string; destination: string; clips: Array<{ id: string; assetId: string; kind: "video" | "audio" | "image"; sourceStartMs: number; sourceEndMs: number; timelineStartMs: number; volume: number; muted?: boolean; transitionType?: "fade-black" | "fade-white" | "flash"; transitionMs?: number }>; motion: Array<{ text: string; startMs: number; endMs: number; durationMs?: number; preset?: "pop" | "slide" | "zoom" | "typewriter" | "impact" | "composition"; color: string; fontSize: number; x: number; y: number; fontFamily?: string; fontWeight?: number; textAlign?: "left" | "center" | "right"; isCaption?: boolean; lucideIconPng?: string; lucideIconAnchor?: "left" | "right" | "top" | "bottom"; lucideIconSize?: number; lucideIconOffsetX?: number; lucideIconOffsetY?: number; soundId?: string; soundVolume?: number }>; soundEffects?: Array<{ soundId: string; timelineStartMs: number; volume: number }> }) =>
    runTrackedTask("export", "Exportação de vídeo", () => invoke<string>("export_timeline", {
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
    })),

  subscribeToTranscriptionProgress: (onProgress: (progress: TranscriptionProgress) => void) =>
    listen<TranscriptionProgress>("transcription-progress", event => onProgress(event.payload)),

  subscribeToYoutubeProgress: (
    onProgress: (progress: DownloadProgress) => void,
  ) =>
    listen<DownloadProgress>("youtube-download-progress", (event) =>
      onProgress(event.payload),
    ),
};
