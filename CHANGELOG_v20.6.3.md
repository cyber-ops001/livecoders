# Live Coders v20.6.3

- Fixed reel cover upload with a dedicated `post-media` storage path and clearer validation/errors.
- Reel covers accept JPG/PNG/WEBP only, must be exactly 16:9, and must be 8 MB or smaller.
- Reel cover upload happens before video upload to avoid unnecessary video uploads when the cover is invalid.
- Reduced feed image/video presentation to a compact Twitter-style 16:9 card, with responsive mobile sizing.
- Added automatic long-post text truncation with `Read more` / `Show less`.
- Kept existing post/reel publishing flow and dark UI intact.

## v20.6.4 — Focused Search & Followed Feed Refresh
- Global top search now searches only Developers, Posts and Reels.
- Added clickable Developers / Posts / Reels search tabs with no result counts.
- Community search remains separate inside Explore/Communities.
- Home feed now has Posts / Blogs / Reels tabs without quantity badges.
- Followed creators' newest posts are explicitly prioritized in the feed.
- New posts from followed creators are surfaced in the current session through realtime updates and remain prioritized until refresh.
- Home feed continues to fetch fresh content whenever the page is refreshed.
