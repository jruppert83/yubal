import { basePath } from "@/lib/base-path";

export type SearchResultType = "song" | "artist" | "album" | "playlist" | "video" | "unknown";

export interface YTMSearchResult {
  category?: string | null;
  resultType?: string;
  title?: string;
  artist?: string;
  artists?: { name: string; id?: string }[];
  album?: { name: string; id?: string } | string | null;
  type?: string;
  year?: string;
  duration?: string | null;
  subscribers?: string;
  author?: string | null;
  thumbnails?: { url: string; width: number; height: number }[];
  videoId?: string;
  browseId?: string;
  playlistId?: string;
  url?: string;
  isExplicit?: boolean;
  [key: string]: unknown;
}

export interface RawAlbumDetails {
  title: string;
  artists?: { name: string; id?: string }[];
  year?: string;
  thumbnails?: { url: string; width: number; height: number }[];
  tracks: YTMSearchResult[];
  playlistId?: string;
  url?: string;
}

export interface NormalizedSearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  thumbnailUrl?: string;
  artistName?: string;
  albumName?: string;
  duration?: string;
  isTopResult: boolean;
  isExplicit: boolean;
  videoId?: string;
  browseId?: string;
  playlistId?: string;
  url?: string;
  raw: YTMSearchResult;
}

export interface AlbumDetails {
  title: string;
  artistName?: string;
  year?: string;
  thumbnailUrl?: string;
  url?: string;
  tracks: NormalizedSearchResult[];
}

export interface GroupedSearchResults {
  topResult?: NormalizedSearchResult;
  songs: NormalizedSearchResult[];
  albums: NormalizedSearchResult[];
  artists: NormalizedSearchResult[];
  playlists: NormalizedSearchResult[];
}

function buildApiUrl(path: string): string {
  const cleanBase = basePath ? basePath.replace(/\/$/, "") : "";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}/api${cleanPath}`;
}

async function fetchJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint);
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 150)}`);
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`Expected JSON but got '${contentType}': ${text.slice(0, 100)}`);
  }

  return response.json();
}

export function normalizeSearchResult(raw: YTMSearchResult): NormalizedSearchResult {
  let rawType = (raw.resultType || raw.type || "unknown").toLowerCase();
  if (rawType === "single" || rawType === "ep") rawType = "album";

  const resultType = rawType as SearchResultType;
  const isTopResult = raw.category === "Top result";

  let title = raw.title || "";
  let artistName: string | undefined;

  if (raw.artists?.length) {
    artistName = raw.artists.map((a) => a.name).join(", ");
  } else if (raw.artist) {
    artistName = raw.artist;
  }

  if (resultType === "artist") {
    title = raw.artist || raw.artists?.[0]?.name || raw.title || "Unknown Artist";
  }

  const albumName =
    typeof raw.album === "object" && raw.album !== null
      ? raw.album.name
      : typeof raw.album === "string"
      ? raw.album
      : undefined;

  const thumbnailUrl = raw.thumbnails?.length
    ? raw.thumbnails[raw.thumbnails.length - 1].url
    : undefined;

  let subtitle = "";
  switch (resultType) {
    case "artist":
      subtitle = raw.subscribers ? `${raw.subscribers} subscribers` : "Artist";
      break;
    case "album":
      subtitle = [raw.type || "Album", artistName, raw.year].filter(Boolean).join(" • ");
      break;
    case "playlist":
      subtitle = [raw.author || artistName, "Playlist"].filter(Boolean).join(" • ");
      break;
    default:
      subtitle = [artistName, albumName, raw.duration || undefined]
        .filter(Boolean)
        .join(" • ");
      break;
  }

  const id =
    raw.videoId ||
    raw.browseId ||
    raw.playlistId ||
    `${resultType}-${title}-${Math.random()}`;

  const downloadUrl =
    raw.url ||
    (raw.videoId
      ? `https://music.youtube.com/watch?v=${raw.videoId}`
      : raw.playlistId || raw.browseId
      ? `https://music.youtube.com/playlist?list=${raw.playlistId || raw.browseId}`
      : undefined);

  return {
    id,
    type: resultType,
    title,
    subtitle,
    thumbnailUrl,
    artistName,
    albumName,
    duration: raw.duration || undefined,
    isTopResult,
    isExplicit: Boolean(raw.isExplicit),
    videoId: raw.videoId,
    browseId: raw.browseId,
    playlistId: raw.playlistId,
    url: downloadUrl,
    raw,
  };
}

export function groupSearchResults(results: NormalizedSearchResult[]): GroupedSearchResults {
  const grouped: GroupedSearchResults = {
    songs: [],
    albums: [],
    artists: [],
    playlists: [],
  };

  for (const item of results) {
    if (item.isTopResult && !grouped.topResult) grouped.topResult = item;
    switch (item.type) {
      case "song":
      case "video":
        grouped.songs.push(item);
        break;
      case "album":
        grouped.albums.push(item);
        break;
      case "artist":
        grouped.artists.push(item);
        break;
      case "playlist":
        grouped.playlists.push(item);
        break;
    }
  }

  return grouped;
}

export async function searchMusic(
  query: string,
  filter?: string
): Promise<NormalizedSearchResult[]> {
  console.log("🔍 [searchMusic] Executing search for query:", query);

  if (!query.trim()) {
    console.warn("⚠️ [searchMusic] Query is empty, returning empty list");
    return [];
  }

  const path = `/search?q=${encodeURIComponent(query)}${
    filter ? `&filter=${encodeURIComponent(filter)}` : ""
  }`;

  console.log("🔍 [searchMusic] Fetching from endpoint:", path);

  const rawData = await fetchJson<any>(buildApiUrl(path));
  console.log("🔍 [searchMusic] Raw API response received:", rawData);

  // Extract array whether backend returns array directly or { results: [...] }
  const rawItems = Array.isArray(rawData) ? rawData : (rawData?.results || []);
  console.log("🔍 [searchMusic] Extracted raw items count:", rawItems.length);

  const normalized = rawItems.map(normalizeSearchResult);
  console.log("🔍 [searchMusic] Normalized results sample:", normalized[0]);

  return normalized;
}

export async function fetchAlbumTracks(browseId: string): Promise<AlbumDetails> {
  if (!browseId) throw new Error("browseId is undefined");

  const endpoint = buildApiUrl(`/search/album/${encodeURIComponent(browseId)}`);
  const data = await fetchJson<RawAlbumDetails>(endpoint);

  const thumbnailUrl = data.thumbnails?.length
    ? data.thumbnails[data.thumbnails.length - 1].url
    : undefined;

  return {
    title: data.title || "Unknown Album",
    artistName: data.artists?.map((a) => a.name).join(", "),
    year: data.year,
    thumbnailUrl,
    url: data.url,
    tracks: (data.tracks || []).map((track) =>
      normalizeSearchResult({ ...track, resultType: "song" })
    ),
  };
}

export async function downloadTrack(url: string): Promise<{ job_id: string }> {
  const endpoint = buildApiUrl("/jobs");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error(`Download job request failed: ${response.statusText}`);
  }

  return response.json();
}
