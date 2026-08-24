# Live Coders v20.6.8

- Removed Following and Followers preview cards from profile sidebars.
- Followers/Following modal rows now have instant Follow/Unfollow controls.
- Follow controls update in place without navigating or re-rendering the profile.
- Follow notifications use the existing database trigger; added an optional Unfollow notification trigger migration.
- Notifications show the newest 10 first, with More notifications to reveal older activity.
- Increased notification history retrieval to 1000 records while keeping the initial UI compact.
- Removed unnecessary follower/following queries from profile rendering for faster profile loads.
