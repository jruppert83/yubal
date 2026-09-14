"""Service for fetching playlist information from YouTube Music."""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from ytmusicapi import YTMusic

from yubal import ContentKind, parse_playlist_id
from yubal.client import YTMusicClient
from yubal.models.ytmusic import Playlist
from yubal.utils.url import parse_video_id

from yubal_api.domain.job import ContentInfo

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PlaylistMetadata:
    """Metadata about a playlist."""

    title: str
    thumbnail_url: str | None


@dataclass(frozen=True)
class _Classification:
    """Result of classifying a playlist as album or regular playlist."""

    kind: ContentKind
    year: int | None = None
    artist: str | None = None
    thumbnail_url: str | None = None


class PlaylistInfoService:
    """Service to fetch playlist metadata from YouTube Music."""

    def __init__(self, cookies_path: Path | None = None) -> None:
        """Initialize the service.

        Args:
            cookies_path: Optional path to cookies.txt for authenticated requests.
        """
        self._client = YTMusicClient(cookies_path=cookies_path)
    @property
    def yt_client(self) -> Any:
        """Expose the raw ytmusicapi client instance wrapped inside YTMusicClient."""
        return (
            getattr(self._client, "_ytmusic", None)
            or getattr(self._client, "ytmusic", None)
            or getattr(self._client, "_client", None)
            or getattr(self._client, "client", None)
            or self._client
        )
    def get_playlist_metadata(self, url: str) -> PlaylistMetadata:
        """Get the metadata of a playlist from its URL.

        Args:
            url: YouTube Music playlist URL.

        Returns:
            PlaylistMetadata containing title and thumbnail URL.

        Raises:
            PlaylistParseError: If URL cannot be parsed (400).
            PlaylistNotFoundError: If playlist doesn't exist (404).
            AuthenticationRequiredError: If authentication is required (401).
            UnsupportedPlaylistError: If playlist type is not supported (422).
            UpstreamAPIError: If API request fails (502).
        """
        playlist_id = parse_playlist_id(url)
        playlist = self._client.get_playlist(playlist_id)
        title = playlist.title or "Unknown Playlist"
        thumbnail_url = playlist.thumbnails[-1].url if playlist.thumbnails else None
        return PlaylistMetadata(title=title, thumbnail_url=thumbnail_url)

    def get_content_info(self, url: str) -> ContentInfo:
        """Get content info for any supported YouTube URL.

        Returns quick metadata (title, artist, kind, track count, year,
        thumbnail) from a single API call without running the full
        extraction pipeline.

        Args:
            url: YouTube Music URL (playlist, album, or single track).

        Returns:
            ContentInfo with metadata from the URL.

        Raises:
            PlaylistParseError: If URL cannot be parsed (400).
            TrackParseError: If single track URL is invalid (400).
            PlaylistNotFoundError: If playlist doesn't exist (404).
            TrackNotFoundError: If track doesn't exist (404).
            AuthenticationRequiredError: If authentication is required (401).
            UnsupportedPlaylistError: If playlist type is not supported (422).
            UpstreamAPIError: If API request fails (502).
        """
        video_id = parse_video_id(url)
        if video_id:
            return self._get_track_content_info(video_id, url)
        return self._get_playlist_content_info(url)

    def _get_playlist_content_info(self, url: str) -> ContentInfo:
        """Build ContentInfo from a playlist/album URL."""
        playlist_id = parse_playlist_id(url)
        playlist = self._client.get_playlist(playlist_id)

        cls = self._classify(playlist)

        return ContentInfo(
            title=playlist.title or "Unknown",
            artist=cls.artist
            or (playlist.author.name if playlist.author else "Unknown Artist"),
            year=cls.year,
            track_count=len(playlist.tracks),
            playlist_id=playlist_id,
            url=url,
            thumbnail_url=cls.thumbnail_url
            or (playlist.thumbnails[-1].url if playlist.thumbnails else None),
            kind=cls.kind,
        )

    def _classify(self, playlist: Playlist) -> "_Classification":
        """Classify playlist as album or playlist and extract metadata.

        Uses the same logic as the regular extraction flow:
        1. All tracks must reference the same album ID
        2. The album must be fetchable
        3. The playlist must contain all album tracks

        For confirmed albums, also extracts artist and thumbnail from the
        album object (since album playlists have no author or thumbnails).

        Returns:
            Classification result with kind, year, artist, and thumbnail.
        """
        if not playlist.tracks:
            return _Classification(kind=ContentKind.PLAYLIST)

        # Check if all tracks reference the same album
        album_ids = {t.album.id for t in playlist.tracks if t.album and t.album.id}
        if len(album_ids) != 1:
            return _Classification(kind=ContentKind.PLAYLIST)

        album_id = next(iter(album_ids))
        try:
            album = self._client.get_album(album_id)
        except Exception:
            logger.debug("Could not fetch album %s for classification", album_id)
            return _Classification(kind=ContentKind.PLAYLIST)

        # Verify playlist contains all album tracks
        if len(playlist.tracks) != len(album.tracks):
            return _Classification(kind=ContentKind.PLAYLIST)

        year = None
        if album.year:
            try:
                year = int(album.year)
            except ValueError:
                pass

        artist = album.artists[0].name if album.artists else None
        thumbnail_url = album.thumbnails[-1].url if album.thumbnails else None

        return _Classification(
            kind=ContentKind.ALBUM,
            year=year,
            artist=artist,
            thumbnail_url=thumbnail_url,
        )

    def _get_track_content_info(self, video_id: str, url: str) -> ContentInfo:
        """Build ContentInfo from a single track URL."""
        track = self._client.get_track(video_id)

        return ContentInfo(
            title=track.title,
            artist=(track.artists[0].name if track.artists else "Unknown Artist"),
            playlist_id=video_id,
            url=url,
            thumbnail_url=(track.thumbnails[-1].url if track.thumbnails else None),
            kind=ContentKind.TRACK,
        )
    def search(
        self, query: str, filter_type: str | None = None
    ) -> list[dict[str, Any]]:
        """Search YouTube Music across songs, artists, albums, or playlists.

        Args:
            query: Search query string.
            filter_type: Optional filter ('songs', 'albums', 'artists', 'playlists').

        Returns:
            List of search result dicts.
        """
        return self._client.search(query, filter=filter_type)

    def get_album(self, browse_id: str) -> dict[str, Any]:
        """Fetch album details and tracklist by browse ID."""
        # 1. Check common client attribute names
        for attr_name in ("yt", "_yt", "ytmusic", "_ytmusic", "client", "_client", "yt_client", "_yt_client", "api"):
            client = getattr(self, attr_name, None)
            if client and hasattr(client, "get_album"):
                return client.get_album(browse_id)

        # 2. Dynamic scan of all object attributes for any client with a get_album method
        for attr_name in dir(self):
            if attr_name.startswith("__"):
                continue
            try:
                attr = getattr(self, attr_name, None)
                if attr and hasattr(attr, "get_album") and callable(getattr(attr, "get_album")):
                    return attr.get_album(browse_id)
            except Exception:
                continue

        raise RuntimeError(
            f"No YTMusic client found on PlaylistInfoService. Instance keys: {list(getattr(self, '__dict__', {}).keys())}"
        )
