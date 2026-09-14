"""Search and metadata lookup endpoints for YouTube Music."""

import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Query

from yubal_api.api.deps import PlaylistInfoServiceDep

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Search"])


def _to_dict(obj: Any) -> dict[str, Any]:
    """Convert any model instance, object, or dictionary into a standard dict."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return dict(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict") and callable(obj.dict):
        return obj.dict()
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in vars(obj).items() if not k.startswith("_")}
    return {}


def _enrich_item(item: dict[str, Any]) -> dict[str, Any]:
    """Ensure standard item structure and construct full YouTube Music URLs."""
    if not isinstance(item, dict):
        return item

    # 1. Map video_id to videoId
    if "video_id" in item and "videoId" not in item:
        item["videoId"] = item["video_id"]

    video_id = item.get("videoId")
    browse_id = item.get("browseId")
    playlist_id = item.get("playlistId") or item.get("audioPlaylistId") or item.get("audio_playlist_id")

    # 2. Add uniform 'id' property required by frontend keys
    if not item.get("id"):
        item["id"] = video_id or browse_id or playlist_id

    # 3. Align 'type' and 'resultType'
    if not item.get("type") and item.get("resultType"):
        item["type"] = item["resultType"]
    elif not item.get("resultType") and item.get("type"):
        item["resultType"] = item["type"]

    # 4. Standardize URLs
    if video_id and not item.get("url"):
        item["url"] = f"https://music.youtube.com/watch?v={video_id}"
    elif playlist_id and not item.get("url"):
        item["url"] = f"https://music.youtube.com/playlist?list={playlist_id}"
    elif browse_id and not item.get("url"):
        item["url"] = f"https://music.youtube.com/browse/{browse_id}"

    return item


def _get_client(service: Any) -> Any:
    """Extract standard ytmusicapi instance by inspecting PlaylistInfoService hierarchy."""
    if service is None:
        raise RuntimeError("PlaylistInfoService dependency was not provided")

    yt_client = getattr(service, "yt_client", None)
    if yt_client and hasattr(yt_client, "search"):
        return yt_client

    inner_wrapper = getattr(service, "_client", None) or getattr(service, "client", None)
    if inner_wrapper:
        for attr in ("_ytmusic", "ytmusic", "_yt_client", "yt_client", "_client", "client"):
            c = getattr(inner_wrapper, attr, None)
            if c and hasattr(c, "search"):
                return c
        if hasattr(inner_wrapper, "search"):
            return inner_wrapper

    if hasattr(service, "search"):
        return service

    raise RuntimeError("Could not locate ytmusicapi client instance on PlaylistInfoService")


# CURRENT CODE (Unfiltered missing limit=60)
#raw_results = client.search(q, filter=filter_type, limit=60) if filter_type else client.search(q)
@router.get("/search")
def search_ytmusic(
    q: str = Query(..., min_length=1, description="Search query"),
    filter_type: str | None = Query(None, alias="filter", description="Optional filter"),
    playlist_info: PlaylistInfoServiceDep,
) -> dict[str, Any]:
    """Search YouTube Music for songs, albums, artists, or playlists."""
    try:
        client = _get_client(playlist_info)
        raw_results = (
            client.search(q, filter=filter_type, limit=60)
            if filter_type
            else client.search(q, limit=60)
        )

        enriched_results = []
        if isinstance(raw_results, list):
            for res in raw_results:
                res_dict = _to_dict(res)
                if res_dict:
                    _enrich_item(res_dict)
                    enriched_results.append(res_dict)

        # If doing a default mixed search, prioritize albums and cap songs to top 10
        if not filter_type:
            top_results = [r for r in enriched_results if r.get("category") == "Top result"]
            albums = [r for r in enriched_results if str(r.get("type")).lower() == "album" and r not in top_results]artists = [r for r in enriched_results if r.get("type") == "artist" and r not in top_results]
            playlists = [r for r in enriched_results if r.get("type") == "playlist" and r not in top_results]
            songs = [r for r in enriched_results if r.get("type") in ("song", "video") and r not in top_results][:10]

            # Re-combine with albums first, followed by top 10 songs, artists, and playlists
            enriched_results = top_results + albums + songs + artists + playlists

        return {"results": enriched_results}
    except Exception as err:
        logger.error("Search failed for query '%s': %s", q, err, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Search failed: {str(err)}")

@router.get("/search/album/{browse_id}")
def get_album_tracks(
    browse_id: str,
    playlist_info: PlaylistInfoServiceDep,
) -> dict[str, Any]:
    """Fetch tracklist for an album browseId (MPRE...) or playlist ID (OLAK...)."""
    try:
        client = _get_client(playlist_info)
    except Exception as err:
        logger.error("Failed getting client: %s", err)
        raise HTTPException(status_code=500, detail=str(err))

    # 1. Handle Playlist IDs (OLAK5uy... or VL...)
    if browse_id.startswith("OLAK") or browse_id.startswith("VL"):
        try:
            raw_data = client.get_playlist(browse_id)
            data = _to_dict(raw_data)
            raw_tracks = data.get("tracks", [])
            tracks = []

            for t in raw_tracks:
                t_dict = _to_dict(t)
                t_dict["album"] = data.get("title")
                t_dict["resultType"] = "song"
                _enrich_item(t_dict)
                tracks.append(t_dict)

            return {
                "title": data.get("title"),
                "artists": data.get("author", []),
                "year": data.get("year"),
                "thumbnails": data.get("thumbnails", []),
                "tracks": tracks,
                "playlistId": browse_id,
                "url": f"https://music.youtube.com/playlist?list={browse_id}",
            }
        except Exception as err:
            logger.warning("Failed fetching playlist ID %s: %s", browse_id, err)
            raise HTTPException(status_code=404, detail=f"Playlist or album not found for ID '{browse_id}'")

    # 2. Handle Album Browse IDs (MPRE...)
    target_id = browse_id if browse_id.startswith("MPRE") else f"MPREb_{browse_id}"

    try:
        raw_album = client.get_album(target_id)
        album_data = _to_dict(raw_album)

        album_title = album_data.get("title")
        raw_tracks = album_data.get("tracks", [])
        tracks = []

        for t in raw_tracks:
            t_dict = _to_dict(t)
            t_dict["album"] = album_title
            t_dict["resultType"] = "song"
            _enrich_item(t_dict)
            tracks.append(t_dict)

        audio_playlist_id = (
            album_data.get("audioPlaylistId")
            or album_data.get("audio_playlist_id")
            or album_data.get("playlistId")
        )

        return {
            "title": album_title,
            "artists": album_data.get("artists", []),
            "year": album_data.get("year"),
            "thumbnails": album_data.get("thumbnails", []),
            "tracks": tracks,
            "playlistId": audio_playlist_id,
            "url": f"https://music.youtube.com/playlist?list={audio_playlist_id}"
            if audio_playlist_id
            else (f"https://music.youtube.com/browse/{target_id}" if target_id else None),
        }
    except Exception as err:
        logger.warning("ytmusicapi failed fetching album for ID %s: %s", target_id, err)
        raise HTTPException(
            status_code=404,
            detail=f"Album '{target_id}' was not found on YouTube Music or is invalid."
        )
