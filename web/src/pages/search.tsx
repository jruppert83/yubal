import {
  fetchAlbumTracks,
  groupSearchResults,
  searchMusic,
  type AlbumDetails,
  type NormalizedSearchResult,
} from "@/api/search";
import { useJobs } from "@/features/jobs/jobs-context";
import { Button } from "@heroui/react";
import { useSearch } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  DiscIcon,
  DownloadIcon,
  Loader2Icon,
  MusicIcon,
  SearchIcon,
  UserIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

export function SearchPage() {
  const searchParams = useSearch({ strict: false }) as { q?: string };
  const query = searchParams.q || "";

  const [results, setResults] = useState<NormalizedSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Album drill-down state
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumDetails | null>(null);
  const [isLoadingAlbum, setIsLoadingAlbum] = useState(false);

  // Track clicked download URLs
  const [disabledUrls, setDisabledUrls] = useState<string[]>([]);

  // Consume startJob from jobs context
  const { startJob } = useJobs();

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    setSelectedAlbum(null);

    searchMusic(query)
      .then((data) => {
        setResults(Array.isArray(data) ? data : []);
      })
      .catch((err) => console.error("Search error:", err))
      .finally(() => setIsLoading(false));
  }, [query]);

  // Dispatch download directly through startJob & disable button
  const handleDownload = async (url?: string) => {
    if (!url) return;
    setDisabledUrls((prev) => [...prev, url]);
    try {
      await startJob(url, 100);
    } catch (err) {
      console.error("Failed to queue download job:", err);
    }
  };

  const handleAlbumClick = async (album: NormalizedSearchResult) => {
    if (!album.browseId) {
      console.warn("Selected album missing browseId:", album);
      return;
    }
    setIsLoadingAlbum(true);
    try {
      const details = await fetchAlbumTracks(album.browseId);
      setSelectedAlbum(details);
    } catch (err) {
      console.error("Failed to fetch album details:", err);
    } finally {
      setIsLoadingAlbum(false);
    }
  };

  const grouped = groupSearchResults(results);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SearchIcon className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">
            {query ? `Results for "${query}"` : "Search Music"}
          </h1>
        </div>
        {selectedAlbum && (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setSelectedAlbum(null)}
          >
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
            Back to Search
          </Button>
        )}
      </div>

      {/* Loading States */}
      {(isLoading || isLoadingAlbum) && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2Icon className="mr-2 h-6 w-6 animate-spin" />
          {isLoadingAlbum ? "Loading album tracks..." : "Searching YouTube Music..."}
        </div>
      )}

      {/* 1. ALBUM DRILL-DOWN VIEW */}
      {!isLoading && !isLoadingAlbum && selectedAlbum && (
        <div className="flex flex-col gap-6">
          <div className="border-separator bg-background/50 flex flex-col items-start gap-4 rounded-xl border p-6 sm:flex-row sm:items-center">
            {selectedAlbum.thumbnailUrl && (
              <img
                src={selectedAlbum.thumbnailUrl}
                alt={selectedAlbum.title}
                className="h-28 w-28 rounded-lg object-cover shadow-md"
              />
            )}
            <div className="flex-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Album
              </span>
              <h2 className="text-2xl font-bold text-foreground">
                {selectedAlbum.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selectedAlbum.artistName} {selectedAlbum.year ? `• ${selectedAlbum.year}` : ""}
              </p>
            </div>
            {selectedAlbum.url && (
              <Button
                variant="primary"
                isDisabled={disabledUrls.includes(selectedAlbum.url)}
                onPress={() => handleDownload(selectedAlbum.url)}
              >
                <DownloadIcon className="h-4 w-4" />
                {disabledUrls.includes(selectedAlbum.url) ? "Queued" : "Download Full Album"}
              </Button>
            )}
          </div>

          <ul className="flex flex-col gap-2">
            {selectedAlbum.tracks.map((track, idx) => {
              const isQueued = Boolean(track.url && disabledUrls.includes(track.url));
              return (
                <li
                  key={track.id}
                  className="border-separator bg-background/50 flex items-center justify-between rounded-lg border p-3 hover:bg-background/80"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="w-6 text-center text-sm text-muted-foreground">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground">
                        {track.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {track.artistName} {track.duration ? `• ${track.duration}` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={isQueued}
                    onPress={() => handleDownload(track.url)}
                  >
                    <DownloadIcon className="h-4 w-4" />
                    {isQueued ? "Queued" : "Download"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 2. CATEGORIZED TIERED SEARCH VIEW */}
      {!isLoading && !isLoadingAlbum && !selectedAlbum && results.length > 0 && (
        <div className="flex flex-col gap-8">
          {/* Songs Section */}
          {grouped.songs.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <MusicIcon className="h-5 w-5 text-muted-foreground" />
                Songs
              </h2>
              <ul className="flex flex-col gap-2">
                {grouped.songs.map((song) => {
                  const isQueued = Boolean(song.url && disabledUrls.includes(song.url));
                  return (
                    <li
                      key={song.id}
                      className="border-separator bg-background/50 flex items-center gap-4 rounded-lg border p-3"
                    >
                      {song.thumbnailUrl && (
                        <img
                          src={song.thumbnailUrl}
                          alt={song.title}
                          className="h-12 w-12 rounded-md object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-foreground">
                          {song.title}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {song.subtitle}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={isQueued}
                        onPress={() => handleDownload(song.url)}
                      >
                        <DownloadIcon className="h-4 w-4" />
                        {isQueued ? "Queued" : "Download"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Albums Section */}
          {grouped.albums.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <DiscIcon className="h-5 w-5 text-muted-foreground" />
                Albums
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {grouped.albums.map((album) => (
                  <div
                    key={album.id}
                    onClick={() => handleAlbumClick(album)}
                    className="border-separator bg-background/50 hover:border-primary/50 group flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors"
                  >
                    {album.thumbnailUrl && (
                      <img
                        src={album.thumbnailUrl}
                        alt={album.title}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    )}
                    <p className="group-hover:text-primary line-clamp-1 font-semibold text-foreground">
                      {album.title}
                    </p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {album.subtitle}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Artists Section */}
          {grouped.artists.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <UserIcon className="h-5 w-5 text-muted-foreground" />
                Artists
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {grouped.artists.map((artist) => (
                  <div
                    key={artist.id}
                    className="border-separator bg-background/50 flex items-center gap-3 rounded-lg border p-3"
                  >
                    {artist.thumbnailUrl && (
                      <img
                        src={artist.thumbnailUrl}
                        alt={artist.title}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground">
                        {artist.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {artist.subtitle}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
