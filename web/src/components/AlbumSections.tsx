import React, { useState } from "react";
import {
  NormalizedSearchResult,
  AlbumDetails,
  fetchAlbumTracks,
  downloadTrack,
} from "../api/search";

interface AlbumSectionProps {
  albums: NormalizedSearchResult[];
}

export const AlbumSection: React.FC<AlbumSectionProps> = ({ albums }) => {
  const [activeAlbum, setActiveAlbum] = useState<AlbumDetails | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Click album title to fetch tracklist
  const handleSelectAlbum = async (browseId: string) => {
    setLoading(true);
    try {
      const albumDetails = await fetchAlbumTracks(browseId);
      setActiveAlbum(albumDetails);
    } catch (err) {
      console.error("Failed to load tracks", err);
    } finally {
      setLoading(false);
    }
  };

  // 2. Click download button on any track or full album
  const handleDownload = async (url?: string) => {
    if (!url) return;
    try {
      await downloadTrack(url);
      alert("Download job queued!");
    } catch (err) {
      console.error("Failed to queue download", err);
    }
  };

  // Expanded Album View
  if (activeAlbum) {
    return (
      <div className="album-detail-view">
        <button onClick={() => setActiveAlbum(null)}>← Back to Search</button>

        <header className="album-header">
          {activeAlbum.thumbnailUrl && <img src={activeAlbum.thumbnailUrl} width={100} alt="" />}
          <div>
            <h2>{activeAlbum.title}</h2>
            <p>{activeAlbum.artistName} • {activeAlbum.year}</p>
            {activeAlbum.url && (
              <button onClick={() => handleDownload(activeAlbum.url)}>
                Download Entire Album
              </button>
            )}
          </div>
        </header>

        {/* Individual Song Downloads */}
        <ul className="track-list">
          {activeAlbum.tracks.map((track, index) => (
            <li key={track.id} className="track-row">
              <span>{index + 1}. {track.title}</span>
              <span className="duration">{track.duration}</span>
              <button
                className="download-btn"
                onClick={() => handleDownload(track.url)}
              >
                Download Song
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Tiered Search Album Cards
  return (
    <div className="album-grid">
      {loading && <div>Loading tracklist...</div>}
      {albums.map((album) => (
        <div key={album.id} className="album-card">
          {album.thumbnailUrl && <img src={album.thumbnailUrl} alt="" width={80} />}
          {/* Clickable Title to Drill Down */}
          <h4
            style={{ cursor: "pointer", textDecoration: "underline" }}
            onClick={() => album.browseId && handleSelectAlbum(album.browseId)}
          >
            {album.title}
          </h4>
          <p>{album.subtitle}</p>
        </div>
      ))}
    </div>
  );
};
