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

export const desktopApi = {
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

  subscribeToYoutubeProgress: (
    onProgress: (progress: DownloadProgress) => void,
  ) =>
    listen<DownloadProgress>("youtube-download-progress", (event) =>
      onProgress(event.payload),
    ),
};
