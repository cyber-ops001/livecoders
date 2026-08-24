import { supabase } from "./supabaseClient.js";

export const metadata = {
  title: "Live Coders",
  description: "Build. Get Stuck. Ask. Connect. Solve.",
  icons: {
    icon: "assets/l-coders.png", // Place logo.png in your public/ folder
  },
};

const state = {
  session: null,
  profile: null,
  route: "home",
  selectedConversation: null,
  notifications: [],
  notificationVisibleCount: 10,
  searchTimer: null,
  realtime: null,
  selectedCommunityChannel: null,
  contentPrefs: JSON.parse(
    localStorage.getItem("livecoders-content-prefs") || "{}",
  ),
  messageDrafts: {},
  publicAuthMode: "login",
  feedPriorityIds: [],
  homeFeedPosts: [],
  likedPostIds: new Set(),
  commentLikeIds: new Set(),
  likedPostIdsReady: false,
};

const app = document.querySelector("#app");
const esc = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
const initials = (name = "?") =>
  String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase() || "?";
const timeAgo = (v) =>
  v
    ? new Date(v).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
const signalQueue = new Map();
function trackInterest(type, value) {
  if (!value) return;
  const key = String(value).toLowerCase().trim();
  if (!key) return;
  state.contentPrefs[key] = (state.contentPrefs[key] || 0) + 1;
  state.contentPrefs[`__${type}`] = (state.contentPrefs[`__${type}`] || 0) + 1;
  localStorage.setItem(
    "livecoders-content-prefs",
    JSON.stringify(state.contentPrefs),
  );
  if (state.session) {
    const qKey = `${type}:${key}`;
    signalQueue.set(qKey, (signalQueue.get(qKey) || 0) + 1);
    clearTimeout(trackInterest.flushTimer);
    trackInterest.flushTimer = setTimeout(async () => {
      const batch = [...signalQueue.entries()];
      signalQueue.clear();
      for (const [compound, count] of batch) {
        const [signalType, signalValue] = compound.split(":");
        try {
          await supabase.rpc("record_interest_signal", {
            signal_type_input: signalType,
            signal_value_input: signalValue,
            weight_input: Math.min(count, 10),
          });
        } catch (_e) {
          /* optional V13 analytics RPC; local ranking still works */
        }
      }
    }, 900);
  }
}
function recommendationScore(p) {
  const text = [p.title, p.content, p.category, ...(p.tags || [])]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const [k, v] of Object.entries(state.contentPrefs)) {
    if (k.startsWith("__")) continue;
    if (text.includes(k)) score += Math.min(8, v);
  }
  return score;
}
const image = (url, name, cls = "avatar") =>
  url
    ? `<img class="${cls}" src="${esc(url)}" alt="${esc(name || "Profile picture")}">`
    : `<div class="${cls}">${esc(initials(name))}</div>`;
const empty = (title, text) =>
  `<div class="emptyState"><div class="emptyIcon">&gt;_</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;

function toast(message, type = "info") {
  const root = document.querySelector("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function profile(id = state.session?.user?.id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error(error);
  if (id === state.session?.user?.id) state.profile = data;
  return data;
}

async function loadInterestSignals() {
  if (!state.session) return;
  try {
    const { data, error } = await supabase
      .from("user_interest_signals")
      .select("signal_type,signal_value,score")
      .eq("user_id", state.session.user.id)
      .order("score", { ascending: false })
      .limit(100);
    if (error) return;
    for (const row of data || []) {
      const k = String(row.signal_value || "").toLowerCase();
      if (k)
        state.contentPrefs[k] = Math.max(
          state.contentPrefs[k] || 0,
          Math.min(100, row.score || 0),
        );
    }
    localStorage.setItem(
      "livecoders-content-prefs",
      JSON.stringify(state.contentPrefs),
    );
  } catch (_e) {}
}

async function bootstrap() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  state.session = session;
  if (!session)
    return location.hash === "#login" || location.hash === "#signup"
      ? renderAuth(location.hash.slice(1))
      : renderLanding();
  document.documentElement.dataset.public = "";
  await profile();
  await loadInterestSignals();
  await loadNotifications();
  renderShell();
  await navigate(location.hash.slice(1) || "home");
  subscribeRealtime();
}

supabase.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;
  if (session) {
    document.documentElement.dataset.public = "";
    await profile();
    await loadInterestSignals();
    await loadNotifications();
    renderShell();
    await navigate(location.hash.slice(1) || "home");
    subscribeRealtime();
  } else {
    state.profile = null;
    renderLanding();
  }
});

function renderLanding() {
  document.documentElement.dataset.public = "landing";
  app.innerHTML = `<main class="landingPage">
    <nav class="landingNav">
      <button class="landingBrand" type="button" onclick="window.renderLanding()" aria-label="Live Coders home">
        <img src="assets/live-coders-logo.svg" alt="Live Coders">
        <span><strong>Live Coders</strong><small>Build • Ask • Connect</small></span>
      </button>

      <div class="landingNavLinks">
        <a href="#landing-features" data-landing-scroll="landing-features">Features</a>
        <a href="#landing-communities" data-landing-scroll="landing-communities">Communities</a>
        <a href="#landing-how-it-works" data-landing-scroll="landing-how-it-works">How it works</a>
      </div>

      <div class="landingNavActions">
        <button class="landingLogin" type="button" onclick="showAuth('login')">Log in</button>
        <button class="primary landingSignup" type="button" onclick="showAuth('signup')">Create account</button>
      </div>
    </nav>

    <section class="landingHero">
      <div class="landingHeroCopy">
        <div class="eyebrow">THE SOCIAL NETWORK FOR BUILDERS</div>
        <h1>Build in public.<br><span>Connect with people who build.</span></h1>
        <p>Live Coders is a developer-first network for sharing projects, solving problems, joining focused communities, publishing build stories and meeting the people behind the code.</p>

        <div class="landingCtas">
          <button class="primary landingCta" type="button" onclick="showAuth('signup')">Start building free →</button>
          <button class="landingGhost" type="button" data-landing-scroll="landing-features">Explore the platform</button>
        </div>

        <div class="landingProof">
          <span>✓ Developer communities</span>
          <span>✓ Projects & blogs</span>
          <span>✓ Build reels</span>
          <span>✓ Direct messages</span>
        </div>
      </div>

      <div class="landingVisual" aria-label="Live Coders product preview">
        <div class="landingWindow">
          <div class="windowTop"><span></span><span></span><span></span><b>Live Coders</b></div>
          <div class="windowBody">
            <aside>
              <strong>Live Coders</strong>
              <small>Build • Ask • Connect</small>
              <i>⌂ Home</i><i>⌕ Explore</i><i>◈ Communities</i><i>✉ Messages</i>
            </aside>
            <div class="windowFeed">
              <div class="miniSearch">⌕ Search developers, posts, communities…</div>
              <div class="miniHero">
                <span class="miniLogo">&lt;/&gt;</span>
                <div><b>What are you building?</b><small>Discover developers and ideas matched to what you actually engage with.</small></div>
              </div>
              <div class="miniPost">
                <div class="miniAvatar">BD</div>
                <div>
                  <b>Building a real-time developer community</b>
                  <small>Web Development · Project Showcase</small>
                  <p>Sharing progress, lessons and the next thing I’m shipping.</p>
                  <div class="miniTags"><span>#webdev</span><span>#startup</span><span>#supabase</span></div>
                </div>
              </div>
              <div class="miniRow"><span>◈</span><div><b>Popular communities</b><small>AI • Startups • Web • Mobile • Open Source</small></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="landingStats">
      <div><b>Build</b><span>Share what you're making</span></div>
      <div><b>Connect</b><span>Meet developers with shared momentum</span></div>
      <div><b>Grow</b><span>Learn through communities and conversations</span></div>
    </section>

    <section id="landing-features" class="landingSection">
      <div class="landingSectionHead">
        <div class="eyebrow">ONE PLACE TO BUILD</div>
        <h2>Everything a developer community needs.</h2>
        <p>Designed around builders instead of endless noise.</p>
      </div>

      <div class="landingFeatureGrid">
        <article><span>01</span><h3>Smart developer feed</h3><p>Your feed learns from searches, communities, posts and creators you interact with. No interest questionnaire.</p></article>
        <article><span>02</span><h3>Focused communities</h3><p>Join communities by type — Startups, AI/ML, Web Development, Cybersecurity, Open Source and more.</p></article>
        <article><span>03</span><h3>Build stories</h3><p>Publish quick posts, long-form multi-page blogs or short build reels showing what you are shipping.</p></article>
        <article><span>04</span><h3>Real conversations</h3><p>Use community channels and direct messages to ask questions, collaborate and share progress.</p></article>
        <article><span>05</span><h3>Developer profiles</h3><p>Show projects, skills, experience and the work you are actually building.</p></article>
        <article><span>06</span><h3>Made for every screen</h3><p>A responsive interface that adapts cleanly from phones to large desktop displays.</p></article>
      </div>
    </section>

    <section id="landing-communities" class="landingDarkSection">
      <div class="landingSectionHead">
        <div class="eyebrow">FIND YOUR PEOPLE</div>
        <h2>Communities with a purpose.</h2>
        <p>Every community chooses its own category, rules and focus.</p>
      </div>
      <div class="landingCategoryGrid">${["Startups & Founders", "AI & Machine Learning", "Web Development", "Mobile Development", "Cybersecurity", "Cloud & DevOps", "Game Development", "Open Source", "UI/UX & Design", "Blockchain & Web3", "Programming Languages", "Career & Jobs"].map((x) => `<span>${esc(x)}</span>`).join("")}</div>
    </section>

    <section id="landing-how-it-works" class="landingSection">
      <div class="landingSectionHead">
        <div class="eyebrow">HOW IT WORKS</div>
        <h2>Build. Connect. Share. Grow.</h2>
        <p>Start with your developer identity, discover the right people and turn conversations into progress.</p>
      </div>
      <div class="landingFeatureGrid">
        <article><span>01</span><h3>Create your profile</h3><p>Build your developer identity around your skills, projects and experience.</p></article>
        <article><span>02</span><h3>Discover communities</h3><p>Explore communities around technologies, startups and areas you care about.</p></article>
        <article><span>03</span><h3>Share what you build</h3><p>Publish posts, multi-page blogs and build reels to show your progress.</p></article>
        <article><span>04</span><h3>Connect and collaborate</h3><p>Follow developers, join conversations and message people who can help you move forward.</p></article>
      </div>
    </section>

    <section class="landingSection landingBuilder">
      <div>
        <div class="eyebrow">FOR PEOPLE WHO SHIP</div>
        <h2>Stop building alone.</h2>
        <p>Find the right community, share the next version, ask for help and keep the momentum going.</p>
      </div>
      <button class="primary landingCta" type="button" onclick="showAuth('signup')">Join Live Coders →</button>
    </section>

    <footer class="landingFooter">
      <span>© ${new Date().getFullYear()} Live Coders. All rights reserved.</span>
      <span>Build. Ask. Connect. Solve.</span>
    </footer>
  </main>`;

  // Landing anchors must never enter the authenticated app router.
  app.querySelectorAll("[data-landing-scroll]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const targetId = link.dataset.landingScroll;
      const target = document.getElementById(targetId);
      if (!target) return;
      history.replaceState(null, "", `#${targetId}`);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// Expose the landing-page renderer globally because the landing/auth markup
// uses inline onclick handlers and app.js is loaded as an ES module.
window.renderLanding = renderLanding;

function renderAuth(mode = "login") {
  document.documentElement.dataset.public = "auth";
  state.publicAuthMode = mode === "signup" ? "signup" : "login";
  app.innerHTML = `<main class="authPage"><button class="authBack" onclick="window.renderLanding()">← Back to Live Coders</button><section class="authHero"><img class="authLogo" src="assets/live-coders-logo.svg" alt="Live Coders logo"><div class="eyebrow">DEVELOPER NETWORK</div><h1>Live Coders</h1><p>Build. Get stuck. Ask. Connect. Solve.</p><div class="codeLine"><span>const</span> community = <b>"builders"</b>;</div><div class="authFeatureList"><span>✓ Developer communities</span><span>✓ Project & blog publishing</span><span>✓ Build reels and collaboration</span></div></section><section class="authCard"><div class="tabs"><button class="tab ${state.publicAuthMode === "login" ? "active" : ""}" data-auth="login">Log in</button><button class="tab ${state.publicAuthMode === "signup" ? "active" : ""}" data-auth="signup">Create account</button></div><div class="authDivider"><span>Use your email</span></div><form id="authForm"><div id="signupFields" class="${state.publicAuthMode === "signup" ? "" : "hidden"}"><label>Full name<input name="fullName" autocomplete="name"></label><label>Username<input name="username" autocomplete="username"></label></div><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" required minlength="6" autocomplete="current-password"></label><div id="confirmField" class="${state.publicAuthMode === "signup" ? "" : "hidden"}"><label>Confirm password<input name="confirmPassword" type="password" minlength="6" autocomplete="new-password"></label></div><button class="primary full" id="authSubmit">${state.publicAuthMode === "signup" ? "Create account" : "Log in"}</button><button class="linkButton ${state.publicAuthMode === "signup" ? "hidden" : ""}" type="button" id="forgotBtn">Forgot password?</button></form></section></main>`;
  let modeNow = state.publicAuthMode;
  document.querySelectorAll("[data-auth]").forEach(
    (btn) =>
      (btn.onclick = () => {
        modeNow = btn.dataset.auth;
        state.publicAuthMode = modeNow;
        document
          .querySelectorAll("[data-auth]")
          .forEach((x) => x.classList.toggle("active", x === btn));
        document
          .querySelector("#signupFields")
          .classList.toggle("hidden", modeNow !== "signup");
        document
          .querySelector("#confirmField")
          .classList.toggle("hidden", modeNow !== "signup");
        document.querySelector("#authSubmit").textContent =
          modeNow === "signup" ? "Create account" : "Log in";
        document
          .querySelector("#forgotBtn")
          .classList.toggle("hidden", modeNow === "signup");
      }),
  );
  document.querySelector("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      if (modeNow === "signup") {
        if (f.get("password") !== f.get("confirmPassword"))
          throw new Error("Passwords do not match.");
        const fullName = String(f.get("fullName") || "")
          .trim()
          .replace(/\s+/g, " ");
        const username = String(f.get("username") || "")
          .trim()
          .toLowerCase();
        if (!fullName || fullName.length < 2)
          throw new Error("Enter your full name.");
        if (!/^[a-z0-9_]{3,30}$/.test(username))
          throw new Error("Username must be 3–30 characters.");
        const { data: takenUsername, error: usernameError } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", username)
          .maybeSingle();
        if (usernameError) throw usernameError;
        if (takenUsername) throw new Error("Username already taken.");
        const redirectTo =
          location.origin && location.origin !== "null"
            ? `${location.origin}/`
            : "http://localhost:5500/";
        const { data, error } = await supabase.auth.signUp({
          email: f.get("email"),
          password: f.get("password"),
          options: {
            data: { fullName, username },
            emailRedirectTo: redirectTo,
          },
        });
        if (error) throw error;
        if (data.session) {
          toast("Account created. Welcome to Live Coders!", "success");
          return;
        }
        document.querySelector("#authSubmit").textContent = "Account created";
        toast(
          "Account created. Check your email to verify it, then return here to log in.",
          "success",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: f.get("email"),
          password: f.get("password"),
        });
        if (error) throw error;
      }
    } catch (err) {
      toast(err.message, "error");
    }
  };
  document.querySelector("#forgotBtn").onclick = async () => {
    const email = document.querySelector('input[name="email"]').value.trim();
    if (!email) return toast("Enter your email first.", "error");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin,
    });
    toast(
      error?.message || "Password reset email sent.",
      error ? "error" : "success",
    );
  };
}
window.showAuth = (mode = "login") => renderAuth(mode);

function navItem(route, icon, label, badge = 0) {
  return `<a href="#${route}" data-route="${route}"><span>${icon}</span>${label}${badge ? `<b class="navBadge">${badge}</b>` : ""}</a>`;
}

function renderShell() {
  const avatar = state.profile?.avatar_url;
  const display =
    state.profile?.display_name ||
    state.profile?.full_name ||
    state.profile?.username ||
    "Developer";
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand" onclick="location.hash='home'"><img class="brandLogo" src="assets/live-coders-logo.svg" alt=""><div class="brandText"><strong>Live Coders</strong><small>Build • Ask • Connect</small></div></div><nav>${navItem("home", "⌂", "Home")}${navItem("explore", "⌕", "Explore")}${navItem("communities", "◈", "Communities")}${navItem("myCommunities", "▣", "My Communities")}${navItem("messages", "✉", "Messages")}${navItem("notifications", "●", "Notifications", unreadNotificationCount())}${navItem("profile", "◎", "Profile")}${navItem("settings", "⚙", "Settings")}</nav><div class="sidebarBottom"><button class="ghost full" id="logoutBtn">Log out</button></div></aside><div class="mainArea"><header class="topbar"><div class="mobileBrand"><img class="brandLogo small" src="assets/live-coders-logo.svg" alt=""><strong>Live Coders</strong></div><div class="globalSearch"><span>⌕</span><input id="globalSearch" value="${esc(new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "")}" placeholder="Search developers, posts, reels…"></div><div class="topActions"><button class="notificationBtn" onclick="location.hash='notifications'" aria-label="Notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><b id="notifBadge" class="notificationBadge ${unreadNotificationCount() ? "" : "hidden"}">${unreadNotificationCount()}</b></button><button class="primary" onclick="openPostModal()">+ Create Post</button><button class="topProfile" id="topProfileBtn" aria-label="Open profile">${image(avatar, display, "avatar small")}<span><strong>${esc(display)}</strong><small>@${esc(state.profile?.username || "")}</small></span><span>⌄</span></button><div class="profileMenu hidden" id="profileMenu"><button onclick="location.hash='profile'">View profile</button><button onclick="location.hash='settings'">Settings</button><button id="menuLogout">Log out</button></div></div></header><main id="page"></main></div></div>`;
  document.querySelector("#logoutBtn").onclick = () => supabase.auth.signOut();
  document.querySelector("#menuLogout").onclick = () => supabase.auth.signOut();
  document.querySelector("#topProfileBtn").onclick = () =>
    document.querySelector("#profileMenu")?.classList.toggle("hidden");
  document.addEventListener(
    "click",
    (e) => {
      const m = document.querySelector("#profileMenu"),
        b = document.querySelector("#topProfileBtn");
      if (m && !m.contains(e.target) && b && !b.contains(e.target))
        m.classList.add("hidden");
    },
    { once: true },
  );
  const search = document.querySelector("#globalSearch");
  search.oninput = () => {
    clearTimeout(state.searchTimer);
    const q = search.value.trim();
    state.searchTimer = setTimeout(() => {
      if (q) trackInterest("search", q);
      location.hash = q
        ? `search?q=${encodeURIComponent(q)}&type=posts`
        : "search";
    }, 180);
  };
  search.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = search.value.trim();
      location.hash = q
        ? `search?q=${encodeURIComponent(q)}&type=posts`
        : "search";
    }
  };
}
async function navigate(raw) {
  const [route] = raw.split("?");
  state.route = route || "home";
  const page = document.querySelector("#page");
  if (!page) return;
  document
    .querySelectorAll("[data-route]")
    .forEach((a) =>
      a.classList.toggle("active", a.dataset.route === state.route),
    );
  const query = new URLSearchParams(raw.split("?")[1] || "");
  try {
    if (state.route === "home") await renderHome(page);
    else if (state.route === "search")
      await renderSearch(
        page,
        query.get("q") || "",
        query.get("type") || "posts",
      );
    else if (state.route === "create")
      await renderCreate(page, query.get("mode") || "post");
    else if (state.route === "explore")
      await renderExplore(page, query.get("q") || "");
    else if (state.route === "communities") await renderCommunities(page);
    else if (state.route === "myCommunities") await renderMyCommunities(page);
    else if (state.route === "messages") {
      state.selectedConversation = query.get("conversation");
      await renderMessages(page);
    } else if (state.route === "notifications") await renderNotifications(page);
    else if (state.route === "profile")
      await renderProfile(page, state.session.user.id);
    else if (state.route === "user") await renderProfile(page, query.get("id"));
    else if (state.route === "community")
      await renderCommunityOverview(page, query.get("id"));
    else if (state.route === "communityChat")
      await renderCommunityWorkspace(page, query.get("id"));
    else if (state.route === "settings") await renderSettings(page);
    else await renderHome(page);
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="errorState"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`;
  }
}
window.addEventListener("hashchange", async () => {
  const route = location.hash.slice(1).split("?")[0];
  const landingSections = new Set([
    "landing-features",
    "landing-communities",
    "landing-how-it-works",
  ]);
  if (landingSections.has(route)) {
    if (!state.session && !document.querySelector(".landingPage"))
      renderLanding();
    const target = document.getElementById(route);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (state.session) await navigate(location.hash.slice(1));
  else if (route === "login" || route === "signup") renderAuth(route);
  else renderLanding();
});

function engagementScore(p) {
  const ageHours = Math.max(
    0,
    (Date.now() - new Date(p.created_at || Date.now()).getTime()) / 3600000,
  );
  const freshness = Math.max(0, 48 - ageHours) / 48;
  const engagement =
    Number(p.like_count || 0) * 3 +
    Number(p.comment_count || 0) * 5 +
    Number(p.view_count || 0) * 0.35;
  return Math.min(40, engagement / 10) + freshness * 18;
}

async function getPosts(filter = {}) {
  let q = supabase
    .from("posts")
    .select(
      "*,author:profiles!posts_author_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter.author) q = q.eq("author_id", filter.author);
  const { data, error } = await q;
  if (error) throw error;
  let posts = data || [];

  if (!filter.author && state.session?.user?.id) {
    // Keep followed creators' newest content visible even when recommendation ranking changes.
    const { data: following } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", state.session.user.id)
      .limit(500);
    const followingIds = new Set((following || []).map((x) => x.following_id));
    const missingFollowingIds = [...followingIds].filter(
      (id) => !posts.some((p) => p.author_id === id),
    );
    if (missingFollowingIds.length) {
      const { data: followedPosts } = await supabase
        .from("posts")
        .select(
          "*,author:profiles!posts_author_id_fkey(id,username,display_name,full_name,avatar_url)",
        )
        .in("author_id", missingFollowingIds)
        .order("created_at", { ascending: false })
        .limit(100);
      const map = new Map(posts.map((p) => [p.id, p]));
      (followedPosts || []).forEach((p) => map.set(p.id, p));
      posts = [...map.values()];
    }

    const freshFollowed = posts
      .filter((p) => followingIds.has(p.author_id))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // Posts from people the user follows are always surfaced first for this page load.
    const priorityIds = new Set([
      ...(state.feedPriorityIds || []),
      ...freshFollowed.slice(0, 20).map((p) => p.id),
    ]);
    state.feedPriorityIds = [...priorityIds];

    return posts.sort((a, b) => {
      const ap = priorityIds.has(a.id) ? 1000 : 0;
      const bp = priorityIds.has(b.id) ? 1000 : 0;
      const score = (p) =>
        recommendationScore(p) +
        engagementScore(p) +
        (followingIds.has(p.author_id) ? 16 : 0);
      return bp + score(b) - (ap + score(a));
    });
  }

  return posts.sort(
    (a, b) =>
      recommendationScore(b) +
      engagementScore(b) -
      (recommendationScore(a) + engagementScore(a)),
  );
}

function renderBlogGallery(pages = [], title = "") {
  if (!pages.length) return "";
  const first = pages[0] || {};
  const cover = first.cover
    ? `<div class="blogCoverView"><img loading="lazy" src="${esc(first.cover)}" alt="${esc(title || "Blog cover")}"></div>`
    : "";
  const pageSlides = pages
    .map((page, i) => {
      const imgs = Array.isArray(page?.images) ? page.images : [];
      const text = typeof page === "string" ? page : String(page?.text || "");
      return `<section class="blogPage" data-blog-page="${i}" ${i ? "hidden" : ""}>
      <div class="blogPageHeader"><span class="pageNo">Page ${i + 1} / ${pages.length}</span></div>
      <div class="blogPageFrame">
        ${text ? `<p>${esc(text)}</p>` : ""}
        ${imgs.length ? `<div class="blogImageStrip">${imgs.map((src, j) => `<img loading="lazy" src="${esc(src)}" alt="${esc(title || "Blog image")} ${j + 1}">`).join("")}</div>` : ""}
      </div>
    </section>`;
    })
    .join("");
  return `<div class="blogViewer" data-blog-viewer>
    <div class="blogViewport">
      ${cover}
      <div class="blogPages">${pageSlides}</div>
    </div>
    ${pages.length > 1 ? `<div class="blogPagerControls"><button type="button" class="secondary" data-blog-prev disabled>← Previous</button><span data-blog-counter>Page 1 / ${pages.length}</span><button type="button" class="secondary" data-blog-next>Next →</button></div>` : ""}
  </div>`;
}

function wireBlogViewers(root = document) {
  root.querySelectorAll("[data-blog-viewer]").forEach((viewer) => {
    if (viewer.dataset.wired === "1") return;
    viewer.dataset.wired = "1";
    const pages = [...viewer.querySelectorAll("[data-blog-page]")];
    if (pages.length < 2) return;
    let index = 0;
    const prev = viewer.querySelector("[data-blog-prev]");
    const next = viewer.querySelector("[data-blog-next]");
    const counter = viewer.querySelector("[data-blog-counter]");
    const paint = () => {
      pages.forEach((el, i) => {
        el.hidden = i !== index;
      });
      if (counter) counter.textContent = `Page ${index + 1} / ${pages.length}`;
      if (prev) prev.disabled = index === 0;
      if (next) next.disabled = index === pages.length - 1;
    };
    prev?.addEventListener("click", (e) => {
      e.preventDefault();
      if (index > 0) {
        index--;
        paint();
      }
    });
    next?.addEventListener("click", (e) => {
      e.preventDefault();
      if (index < pages.length - 1) {
        index++;
        paint();
      }
    });
    let touchX = null;
    viewer.addEventListener(
      "touchstart",
      (e) => {
        touchX = e.touches[0]?.clientX ?? null;
      },
      { passive: true },
    );
    viewer.addEventListener(
      "touchend",
      (e) => {
        if (touchX == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
        if (Math.abs(dx) > 45) {
          if (dx < 0 && index < pages.length - 1) index++;
          if (dx > 0 && index > 0) index--;
          paint();
        }
        touchX = null;
      },
      { passive: true },
    );
    paint();
  });
}

function renderPostText(text = "", postId = "") {
  const value = String(text || "").trim();
  if (!value) return "";
  const limit = 320;
  if (value.length <= limit) return `<p class="postContent">${esc(value)}</p>`;
  const shortId = `postText-${String(postId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const excerpt = value.slice(0, limit).trimEnd();
  return `<div class="postTextWrap" id="${shortId}"><p class="postContent postExcerpt">${esc(excerpt)}… <button type="button" class="readMoreBtn" onclick="togglePostText('${shortId}')">Read more</button></p><p class="postContent postFullText hidden">${esc(value)} <button type="button" class="readMoreBtn" onclick="togglePostText('${shortId}')">Show less</button></p></div>`;
}

function togglePostText(id) {
  const root = document.getElementById(id);
  if (!root) return;
  root.querySelector(".postExcerpt")?.classList.toggle("hidden");
  root.querySelector(".postFullText")?.classList.toggle("hidden");
}
window.togglePostText = togglePostText;

async function postCard(p, likedOverride = null) {
  trackInterest("category", p.category || "");
  (p.tags || []).slice(0, 5).forEach((t) => trackInterest("topic", t));
  let liked = likedOverride;
  if (liked === null && state.likedPostIdsReady)
    liked = state.likedPostIds.has(p.id);
  if (liked === null || liked === undefined) {
    const { data } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("post_id", p.id)
      .eq("user_id", state.session.user.id)
      .maybeSingle();
    liked = !!data;
  }
  const author = p.author || {};
  const pages = Array.isArray(p.body_pages) ? p.body_pages : [];
  const type =
    p.post_type === "reel" ? "reel" : pages.length > 1 ? "blog" : "post";
  const reelCover = pages[0]?.cover ? ` poster="${esc(pages[0].cover)}"` : "";
  const media = p.media_url
    ? `<div class="postMedia"><${type === "reel" ? 'video controls preload="metadata"' : 'img loading="lazy"'} ${type === "reel" ? `src="${esc(p.media_url)}"${reelCover}` : `src="${esc(p.media_url)}" alt="${esc(p.title || "Post media")}"`} ></${type === "reel" ? "video" : "img"}></div>`
    : "";
  const blog = type === "blog" ? renderBlogGallery(pages, p.title) : "";
  const postCover =
    type === "post" && pages[0]?.cover
      ? `<div class="postCoverView"><img loading="lazy" src="${esc(pages[0].cover)}" alt="${esc(p.title || "Post cover")}"></div>`
      : "";
  const attachments =
    type === "post" &&
    Array.isArray(pages[0]?.attachments) &&
    pages[0].attachments.length
      ? `<div class="postAttachments"><strong>Attachments</strong>${pages[0].attachments.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noreferrer">📎 ${esc(a.name || "Attachment")}</a>`).join("")}</div>`
      : "";
  const textContent = type === "blog" ? "" : renderPostText(p.content, p.id);
  const kindLabel =
    type === "blog" ? "BLOG" : type === "reel" ? "REEL" : "POST";
  const ownActions =
    p.author_id === state.session.user.id
      ? `<button class="postDeleteBtn" onclick="deletePost('${p.id}')" aria-label="Delete ${kindLabel.toLowerCase()}">Delete</button>`
      : "";
  return `<article class="postCard ${type === "reel" ? "reelCard" : ""}" data-post-id="${esc(p.id)}">
    <div class="postHeader"><div class="postAuthor" onclick="location.hash='user?id=${p.author_id}'">${image(author.avatar_url, author.display_name || author.full_name || author.username)}<div><strong>${esc(author.display_name || author.full_name || author.username || "Developer")}</strong><small>@${esc(author.username || "")} · ${timeAgo(p.created_at)}</small></div></div><div class="postHeaderActions"><span class="postKind ${type}">${kindLabel}</span>${ownActions}</div></div>
    <h2>${esc(p.title || kindLabel)}</h2>${textContent}${blog}${postCover}${attachments}${media}
    <div class="tags">${(p.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
    <div class="postMeta"><button class="likeButton" data-like-button="${esc(p.id)}" aria-pressed="${!!liked}" onclick="toggleLike('${p.id}',${!!liked})">${liked ? "♥" : "♡"} ${p.like_count || 0}</button><button class="commentButton" data-comment-button="${esc(p.id)}" onclick="openComments('${p.id}')">💬 ${p.comment_count || 0}</button><button onclick="viewPost('${p.id}')">👁 ${p.view_count || 0}</button><button onclick="location.hash='user?id=${p.author_id}'">Profile</button></div>
  </article>`;
}

async function deletePost(postId) {
  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("id,author_id,title")
    .eq("id", postId)
    .maybeSingle();
  if (fetchError) return toast(fetchError.message, "error");
  if (!post || post.author_id !== state.session.user.id)
    return toast("You can only delete your own posts.", "error");
  if (
    !confirm(
      `Delete "${post.title || "this post"}"?\n\nThis will remove the post and its comments. This cannot be undone.`,
    )
  )
    return;
  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", state.session.user.id);
  if (error) return toast(error.message, "error");
  toast("Post deleted.", "success");
  if (state.route === "home") await renderHome(document.querySelector("#page"));
  else if (state.route === "profile" || state.route === "user")
    await navigate(location.hash.slice(1));
}
window.deletePost = deletePost;

async function renderHome(page) {
  page.innerHTML = `<div class="homeFeedPage">
    <section class="homeFeedIntro">
      <div><div class="eyebrow">YOUR BUILDER FEED</div><h1>Build. Share. Grow together.</h1><p>Your feed is automatically ranked from the developers, communities and topics you engage with.</p></div>
      <div class="homeCreateActions"><button class="primary" onclick="openPostModal('post')">＋ Post</button><button class="secondary" onclick="openPostModal('reel')">▶ Reel</button></div>
    </section>
    <div class="homeFeedTabs" role="tablist" aria-label="Feed content type">
      <button class="feedTab active" data-feed-filter="post" role="tab" aria-selected="true">Posts</button>
      <button class="feedTab" data-feed-filter="blog" role="tab" aria-selected="false">Blogs</button>
      <button class="feedTab" data-feed-filter="reel" role="tab" aria-selected="false">Reels</button>
    </div>
    <div class="homeFeedLayout">
      <section class="homeFeedColumn"><div class="homeFeedLabel"><span id="activeFeedLabel">Posts</span><span class="homeFeedRule">Scroll to explore</span></div><div id="feedList" class="instagramFeed">Loading posts…</div></section>
      <aside class="rightRail homeFeedRail"><div class="card"><h3>Create something</h3><button class="railAction" onclick="openPostModal('post')">＋ Create Post</button><button class="railAction" onclick="openPostModal('reel')">▶ Create Reel</button><button class="railAction" onclick="location.hash='explore'">⌕ Explore developers</button><button class="railAction" onclick="location.hash='communities'">◈ Find communities</button></div><div class="card automatedFeedCard"><h3>Personalized automatically</h3><p class="muted">Your feed adapts to what you search, open, like and discuss. You never need to choose interests manually.</p><div class="autoSignal"><span>●</span> Learning from your activity</div></div></aside>
    </div>
  </div>`;

  const posts = await getPosts();
  state.homeFeedPosts = posts;
  state.likedPostIds = new Set();
  state.likedPostIdsReady = true;
  const homePostIds = posts.map((p) => p.id).filter(Boolean);
  if (homePostIds.length) {
    const { data: likedRows } = await supabase
      .from("post_likes")
      .select("post_id")
      .in("post_id", homePostIds)
      .eq("user_id", state.session.user.id);
    state.likedPostIds = new Set((likedRows || []).map((r) => r.post_id));
  }
  async function paintFeed(filter = "post") {
    const list = document.querySelector("#feedList");
    if (!list) return;
    document.querySelectorAll(".feedTab").forEach((tab) => {
      const active = tab.dataset.feedFilter === filter;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    const label =
      filter === "post" ? "Posts" : filter === "blog" ? "Blogs" : "Reels";
    document.querySelector("#activeFeedLabel").textContent = label;
    const visible = posts.filter((p) => {
      const pages = Array.isArray(p.body_pages) ? p.body_pages : [];
      const type =
        p.post_type === "reel" ? "reel" : pages.length > 1 ? "blog" : "post";
      return type === filter;
    });
    list.innerHTML = visible.length
      ? (
          await Promise.all(
            visible.map((p) => postCard(p, state.likedPostIds.has(p.id))),
          )
        ).join("")
      : empty(
          `No ${label.toLowerCase()} yet`,
          `There are no ${label.toLowerCase()} in your feed yet.`,
        );
    wireBlogViewers(list);
  }
  document
    .querySelectorAll(".feedTab")
    .forEach((tab) =>
      tab.addEventListener("click", () => paintFeed(tab.dataset.feedFilter)),
    );
  await paintFeed("post");
}

async function toggleLike(postId, liked) {
  const button = document.querySelector(
    `[data-like-button="${CSS.escape(postId)}"]`,
  );
  const card = document.querySelector(`[data-post-id="${CSS.escape(postId)}"]`);
  const currentCount = Number(
    (button?.textContent || "").match(/\d+/)?.[0] || 0,
  );
  const nextLiked = !liked;
  const nextCount = Math.max(0, currentCount + (nextLiked ? 1 : -1));
  if (button) {
    button.dataset.pending = "1";
    button.setAttribute("aria-pressed", String(nextLiked));
    button.textContent = `${nextLiked ? "♥" : "♡"} ${nextCount}`;
  }
  state.likedPostIds[nextLiked ? "add" : "delete"](postId);
  const post = await supabase
    .from("posts")
    .select("author_id,title")
    .eq("id", postId)
    .single();
  if (post.error) {
    if (button) {
      button.setAttribute("aria-pressed", String(liked));
      button.textContent = `${liked ? "♥" : "♡"} ${currentCount}`;
      button.dataset.pending = "";
    }
    state.likedPostIds[liked ? "add" : "delete"](postId);
    return toast(post.error.message, "error");
  }
  const res = nextLiked
    ? await supabase
        .from("post_likes")
        .insert({ post_id: postId, user_id: state.session.user.id })
    : await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", state.session.user.id);
  if (res.error) {
    if (button) {
      button.setAttribute("aria-pressed", String(liked));
      button.textContent = `${liked ? "♥" : "♡"} ${currentCount}`;
      button.dataset.pending = "";
    }
    state.likedPostIds[liked ? "add" : "delete"](postId);
    return toast(res.error.message, "error");
  }
  if (button) button.dataset.pending = "";
  if (card) card.dataset.likeCount = String(nextCount);
}
window.toggleLike = toggleLike;

function renderCommentNode(c, byParent, likedSet, postId, depth = 0) {
  const replies = byParent[c.id] || [];
  const liked = likedSet.has(c.id);
  const replyHtml = replies
    .map((r) => renderCommentNode(r, byParent, likedSet, postId, depth + 1))
    .join("");
  return `<div class="comment ${depth ? "replyComment" : ""}" data-comment-id="${esc(c.id)}" data-parent-id="${esc(c.parent_id || "")}" style="margin-left:${Math.min(depth, 3) * 24}px">
    <button class="commentAuthor" onclick="closeModal();location.hash='user?id=${c.author_id}'">${image(c.author?.avatar_url, c.author?.display_name || c.author?.full_name || c.author?.username, "avatar small")}<span><b>${esc(c.author?.display_name || c.author?.full_name || c.author?.username || "User")}</b><small>@${esc(c.author?.username || "")} · ${timeAgo(c.created_at)}</small></span></button>
    <p>${esc(c.content)}</p>
    <div class="commentActions"><button class="commentLikeButton" data-comment-like="${esc(c.id)}" aria-pressed="${liked}" onclick="toggleCommentLike('${c.id}',${liked},'${postId}')">${liked ? "♥" : "♡"} ${c.like_count || 0}</button><button class="replyToggleButton" data-replies-toggle="${esc(c.id)}" onclick="toggleCommentReplies('${c.id}')">Replies${replies.length ? ` (${replies.length})` : ""}</button></div>
    <div class="commentReplies" data-comment-replies="${esc(c.id)}" hidden>${replyHtml}<button class="replyActionButton" type="button" onclick="replyToComment('${c.id}')">↩ Reply</button></div>
  </div>`;
}

async function openComments(postId) {
  const { data: comments, error } = await supabase
    .from("post_comments")
    .select(
      "*,author:profiles!post_comments_author_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) return toast(error.message, "error");
  const ids = (comments || []).map((c) => c.id).filter(Boolean);
  const { data: likes } = ids.length
    ? await supabase
        .from("comment_likes")
        .select("comment_id")
        .in("comment_id", ids)
        .eq("user_id", state.session.user.id)
    : { data: [] };
  const likedSet = new Set((likes || []).map((x) => x.comment_id));
  state.commentLikeIds = likedSet;
  const byParent = {};
  (comments || []).forEach((c) =>
    (byParent[c.parent_id || "root"] ||= []).push(c),
  );
  modal(
    `<div class="commentsModal" data-comments-modal="${esc(postId)}"><div class="commentsModalHeader"><h2>Comments</h2></div><div class="commentList" id="commentList">${(byParent.root || []).map((c) => renderCommentNode(c, byParent, likedSet, postId)).join("") || `<p class="muted">No comments yet.</p>`}</div><form id="commentForm"><label>Add a comment<textarea name="content" rows="3" required placeholder="Share your thoughts…"></textarea></label><input type="hidden" name="parentId"><div class="replyingTo hidden" id="replyingTo"></div><button class="primary full">Comment</button></form></div>`,
  );
  const form = document.querySelector("#commentForm");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const content = String(f.get("content") || "").trim();
    const parentId = f.get("parentId") || null;
    if (!content) return;
    const submit = form.querySelector("button[type=submit]");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Posting…";
    }
    const { data: inserted, error: insertError } = await supabase
      .from("post_comments")
      .insert({
        post_id: postId,
        author_id: state.session.user.id,
        parent_id: parentId,
        content,
      })
      .select(
        "*,author:profiles!post_comments_author_id_fkey(id,username,display_name,full_name,avatar_url)",
      )
      .single();
    if (insertError) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Comment";
      }
      return toast(insertError.message, "error");
    }
    const list = document.querySelector("#commentList");
    list?.querySelector(".muted")?.remove();
    if (parentId) {
      const parentReplies = list?.querySelector(
        `[data-comment-replies="${CSS.escape(parentId)}"]`,
      );
      if (parentReplies) {
        parentReplies.hidden = false;
        const replyButton = parentReplies.querySelector(".replyActionButton");
        replyButton?.insertAdjacentHTML(
          "beforebegin",
          renderCommentNode(
            inserted,
            { root: [], [parentId]: [] },
            new Set(),
            postId,
            1,
          ),
        );
        const toggle = document.querySelector(
          `[data-replies-toggle="${CSS.escape(parentId)}"]`,
        );
        if (toggle) {
          const n = (toggle.textContent.match(/\d+/) || ["0"])[0] * 1 + 1;
          toggle.textContent = `Replies (${n})`;
        }
      }
    } else if (list) {
      list.insertAdjacentHTML(
        "beforeend",
        renderCommentNode(
          inserted,
          { root: [], [inserted.id]: [] },
          new Set(),
          postId,
        ),
      );
    }
    const postCommentButton = document.querySelector(
      `[data-comment-button="${CSS.escape(postId)}"]`,
    );
    if (postCommentButton) {
      const count =
        Number((postCommentButton.textContent || "").match(/\d+/)?.[0] || 0) +
        1;
      postCommentButton.textContent = `💬 ${count}`;
    }
    form.reset();
    form.querySelector('input[name="parentId"]').value = "";
    document.querySelector("#replyingTo")?.classList.add("hidden");
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Comment";
    }
  };
}

function toggleCommentReplies(commentId) {
  const root = document.querySelector(
    `[data-comment-id="${CSS.escape(commentId)}"]`,
  );
  const replies = root?.querySelector(
    `[data-comment-replies="${CSS.escape(commentId)}"]`,
  );
  const button = root?.querySelector(
    `[data-replies-toggle="${CSS.escape(commentId)}"]`,
  );
  if (!replies) return;
  replies.hidden = !replies.hidden;
  if (button) button.setAttribute("aria-expanded", String(!replies.hidden));
}
window.toggleCommentReplies = toggleCommentReplies;

async function toggleCommentLike(commentId, liked, postId) {
  const button = document.querySelector(
    `[data-comment-like="${CSS.escape(commentId)}"]`,
  );
  const currentCount = Number(
    (button?.textContent || "").match(/\d+/)?.[0] || 0,
  );
  const nextLiked = !liked;
  if (button) {
    button.setAttribute("aria-pressed", String(nextLiked));
    button.textContent = `${nextLiked ? "♥" : "♡"} ${Math.max(0, currentCount + (nextLiked ? 1 : -1))}`;
    button.dataset.pending = "1";
  }
  state.commentLikeIds[nextLiked ? "add" : "delete"](commentId);
  const res = nextLiked
    ? await supabase
        .from("comment_likes")
        .insert({ comment_id: commentId, user_id: state.session.user.id })
    : await supabase
        .from("comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", state.session.user.id);
  if (res.error) {
    state.commentLikeIds[liked ? "add" : "delete"](commentId);
    if (button) {
      button.setAttribute("aria-pressed", String(liked));
      button.textContent = `${liked ? "♥" : "♡"} ${currentCount}`;
    }
    return toast(res.error.message, "error");
  }
  if (button) button.dataset.pending = "";
}
window.toggleCommentLike = toggleCommentLike;
function replyToComment(commentId) {
  const input = document.querySelector('#commentForm input[name="parentId"]');
  const notice = document.querySelector("#replyingTo");
  if (input) input.value = commentId;
  if (notice) {
    notice.textContent = "Replying to this comment";
    notice.classList.remove("hidden");
  }
  document.querySelector("#commentForm textarea")?.focus();
}
window.replyToComment = replyToComment;
window.openComments = openComments;
async function viewPost(id) {
  await supabase.rpc("record_post_view", { post_id_input: id });
}
window.viewPost = viewPost;
async function renderSearch(page, q = "", type = "posts") {
  const safeType = ["posts", "developers", "reels"].includes(type)
    ? type
    : "posts";
  const like = q
    ? `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    : null;

  let developers = { data: [], error: null };
  let content = { data: [], error: null };

  if (q && safeType === "developers") {
    developers = await supabase
      .from("profiles")
      .select(
        "id,username,display_name,full_name,avatar_url,bio,skills,location",
      )
      .or(
        `username.ilike.${like},display_name.ilike.${like},full_name.ilike.${like},bio.ilike.${like},location.ilike.${like}`,
      )
      .limit(40);
  }

  if (q && safeType === "posts") {
    content = await supabase
      .from("posts")
      .select(
        "*,author:profiles!posts_author_id_fkey(id,username,display_name,full_name,avatar_url,location)",
      )
      .or(`title.ilike.${like},content.ilike.${like}`)
      .neq("post_type", "reel")
      .order("created_at", { ascending: false })
      .limit(60);
    if (!content.error) {
      content.data = (content.data || []).filter((p) => {
        const pages = Array.isArray(p.body_pages) ? p.body_pages : [];
        return pages.length <= 1;
      });
    }
  }

  if (q && safeType === "reels") {
    content = await supabase
      .from("posts")
      .select(
        "*,author:profiles!posts_author_id_fkey(id,username,display_name,full_name,avatar_url,location)",
      )
      .or(`title.ilike.${like},content.ilike.${like}`)
      .eq("post_type", "reel")
      .order("created_at", { ascending: false })
      .limit(40);
  }

  const error = developers.error || content.error;
  if (error) {
    page.innerHTML = empty(
      "Search error",
      error.message || "Try again in a moment.",
    );
    return;
  }

  if (q) trackInterest("search", q);

  const tabs = [
    ["posts", "Posts"],
    ["developers", "Developers"],
    ["reels", "Reels"],
  ];

  page.innerHTML = `<div class="searchResultsPage">
    <section class="pageHead modernPageHead searchPageHead">
      <div><div class="eyebrow">SEARCH</div><h1>${q ? `Results for “${esc(q)}”` : "Search Live Coders"}</h1><p>Find developers to connect with, posts to learn from, and reels to discover.</p></div>
    </section>
    <div class="searchTabs" role="tablist" aria-label="Search result type">
      ${tabs.map(([key, label]) => `<button class="searchTab ${safeType === key ? "active" : ""}" data-search-type="${key}" role="tab" aria-selected="${safeType === key}">${label}</button>`).join("")}
    </div>
    <section id="searchResultList" class="searchResultList">
      ${
        !q
          ? empty(
              "Start searching",
              "Use the top search bar to find developers, posts or reels.",
            )
          : safeType === "developers"
            ? `<div class="userGrid">${(developers.data || []).map((u) => `<article class="userCard searchUserCard">${image(u.avatar_url, u.display_name || u.full_name || u.username, "avatar large")}<h3>${esc(u.display_name || u.full_name || u.username)}</h3><p>@${esc(u.username)}</p><p>${esc(u.bio || "Developer and builder.")}</p><button class="secondary full" onclick="location.hash='user?id=${u.id}'">View profile</button></article>`).join("") || empty("No developers found", "Try another search.")}</div>`
            : `<div class="searchPostResults">${(await Promise.all((content.data || []).map(postCard))).join("") || empty(`No ${safeType === "reels" ? "reels" : "posts"} found`, "Try another search.")}</div>`
      }
    </section>
  </div>`;

  document.querySelectorAll(".searchTab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const nextType = tab.dataset.searchType;
      location.hash = `search?q=${encodeURIComponent(q)}&type=${nextType}`;
    });
  });
  wireBlogViewers(document.querySelector("#searchResultList"));
}

async function renderExplore(page, q = "") {
  const like = q
    ? `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    : null;
  const [users, posts, communities, members] = await Promise.all([
    q
      ? supabase
          .from("profiles")
          .select(
            "id,username,display_name,full_name,avatar_url,bio,skills,location",
          )
          .or(
            `username.ilike.${like},display_name.ilike.${like},full_name.ilike.${like},bio.ilike.${like},location.ilike.${like}`,
          )
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
    q
      ? supabase
          .from("posts")
          .select(
            "*,author:profiles!posts_author_id_fkey(id,username,display_name,full_name,avatar_url,location)",
          )
          .or(`title.ilike.${like},content.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("communities")
      .select("*")
      .order("member_count", { ascending: false })
      .limit(80),
    supabase
      .from("community_members")
      .select("community_id")
      .eq("user_id", state.session.user.id),
  ]);
  if (users.error || posts.error || communities.error || members.error)
    return (page.innerHTML = empty(
      "Search error",
      users.error?.message ||
        posts.error?.message ||
        communities.error?.message ||
        members.error?.message ||
        "Try again in a moment.",
    ));
  if (q) trackInterest("search", q);
  const joinedIds = new Set((members.data || []).map((x) => x.community_id));
  const categoryList = [
    "Web Development",
    "Mobile Development",
    "AI & Machine Learning",
    "Data Science",
    "Cybersecurity",
    "Cloud & DevOps",
    "Game Development",
    "Blockchain & Web3",
    "Open Source",
    "UI/UX & Design",
    "Startups & Founders",
    "Programming Languages",
    "Career & Jobs",
    "Freelancing",
    "Robotics & IoT",
    "No-Code & Automation",
  ];
  const dbCats = [
    ...(communities.data || []).map((c) => c.category).filter(Boolean),
  ];
  const categories = [...new Set([...categoryList, ...dbCats])];
  const filtered = q
    ? (communities.data || []).filter((c) =>
        [c.name, c.description, c.category, c.location].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q.toLowerCase()),
        ),
      )
    : communities.data || [];
  const popular = filtered.slice(0, 6);
  const trending = [...filtered]
    .sort(
      (a, b) =>
        Number(b.view_count || 0) +
        Number(b.member_count || 0) -
        (Number(a.view_count || 0) + Number(a.member_count || 0)),
    )
    .slice(0, 10);
  page.innerHTML = `<div class="pageHead modernPageHead"><div><div class="eyebrow">DISCOVER</div><h1>Explore Communities</h1><p>Find developer communities by technology, career path, project and goal.</p></div><button class="primary" onclick="openCommunityModal()">+ Create Community</button></div><div class="searchBox modernSearch"><span>⌕</span><input id="communitySearch" value="${esc(q)}" placeholder="Search communities, technologies, goals…"><select id="communityCategory"><option value="">All categories</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div><div class="communityChips"><button class="chip active" data-category="">All</button>${categories.map((c) => `<button class="chip" data-category="${esc(c)}">${esc(c)}</button>`).join("")}</div><div class="exploreSection communityExplore"><section><div class="sectionTitle"><div><h2>Popular Communities</h2><p class="muted">Start with communities developers are actively joining.</p></div><button class="linkButton" onclick="location.hash='communities'">View all →</button></div><div class="communityGrid" id="popularCommunities">${popular.map((c) => communityCard(c, joinedIds)).join("") || empty("No communities", "Create the first one.")}</div></section>${q ? `<section id="searchResults"><div class="sectionTitle"><div><h2>Developer & Post Results</h2><p class="muted">Results for “${esc(q)}”.</p></div></div><div class="userGrid">${(users.data || []).map((u) => `<article class="userCard">${image(u.avatar_url, u.display_name || u.full_name || u.username, "avatar large")}<h3>${esc(u.display_name || u.full_name || u.username)}</h3><p>@${esc(u.username)}</p><p>${esc(u.bio || "Developer and builder.")}</p><button class="secondary full" onclick="location.hash='user?id=${u.id}'">View profile</button></article>`).join("") || empty("No developers", "Try another search.")}</div></section>` : ""}<section><div class="sectionTitle"><div><h2>Trending Communities</h2><p class="muted">Popular right now based on activity and views.</p></div></div><div class="trendingCommunityList">${trending.map((c) => `<div class="trendingCommunityRow">${image(c.logo_url, c.name, "communityIcon small")}<div><b>${esc(c.name)}</b><small>${esc(c.category || "Community")} · ${Number(c.member_count || 0).toLocaleString()} members</small><p>${esc(c.description || "Developer community")}</p></div><div class="trendMetric">↗ ${Number(c.view_count || 0).toLocaleString()}<small>views</small></div><div>${joinedIds.has(c.id) ? `<button class="secondary" onclick="location.hash='community?id=${c.id}'">View</button>` : `<button class="primary" onclick="location.hash='community?id=${c.id}'">View & Join</button>`}</div></div>`).join("") || `<div class="sideMuted">No communities found.</div>`}</div></section></div>`;
  const applyFilter = () => {
    const text = document.querySelector("#communitySearch").value.trim();
    const cat = document.querySelector("#communityCategory").value;
    trackInterest("category", cat);
    location.hash = `explore${text ? `?q=${encodeURIComponent(text)}` : ""}`;
    setTimeout(() => {
      const cards = document.querySelectorAll(
        "#popularCommunities .communityCard",
      );
      cards.forEach((card) => {
        card.style.display =
          !cat || card.dataset.category === cat ? "" : "none";
      });
    }, 0);
  };
  document.querySelector("#communitySearch").oninput = () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => applyFilter(), 280);
  };
  document.querySelector("#communityCategory").onchange = applyFilter;
  document.querySelectorAll(".chip").forEach(
    (ch) =>
      (ch.onclick = () => {
        document
          .querySelectorAll(".chip")
          .forEach((x) => x.classList.remove("active"));
        ch.classList.add("active");
        document.querySelector("#communityCategory").value =
          ch.dataset.category;
        document
          .querySelectorAll("#popularCommunities .communityCard")
          .forEach(
            (card) =>
              (card.style.display =
                !ch.dataset.category ||
                card.dataset.category === ch.dataset.category
                  ? ""
                  : "none"),
          );
        trackInterest("category", ch.dataset.category);
      }),
  );
}
function communityCard(c, joinedIds = new Set()) {
  const joined = joinedIds.has(c.id) || c._joined;
  return `<article class="communityCard" data-category="${esc(c.category || "")}"><div class="communityCardCover">${image(c.logo_url, c.name, "communityIcon xl")}</div><div class="communityCardBody"><span class="categoryPill">${esc(c.category || "Community")}</span><h3>${esc(c.name)}</h3><p>${esc(c.description || "Connect, share knowledge and build together.")}</p><small>${Number(c.member_count || 0).toLocaleString()} members · ${Number(c.view_count || 0).toLocaleString()} views</small><div class="communityCardActions"><button class="secondary" onclick="location.hash='community?id=${c.id}'">View community</button>${joined ? `<button class="primary" onclick="location.hash='communityChat?id=${c.id}'">Open</button>` : `<button class="primary" onclick="joinCommunity('${c.id}')">Join</button>`}</div></div></article>`;
}
window.joinCommunity = async function (id) {
  const { data, error } = await supabase
    .from("community_members")
    .insert({ community_id: id, user_id: state.session.user.id });
  if (error)
    return toast(
      error.message.includes("duplicate")
        ? "You are already a member of this community."
        : error.message,
      "error",
    );
  toast("Joined community.", "success");
  navigate(`communityChat?id=${id}`);
};
async function renderCommunities(page) {
  const [{ data, error }, { data: members, error: memberError }] =
    await Promise.all([
      supabase
        .from("communities")
        .select("*")
        .order("member_count", { ascending: false }),
      supabase
        .from("community_members")
        .select("community_id")
        .eq("user_id", state.session.user.id),
    ]);
  if (error || memberError) throw error || memberError;
  const joinedIds = new Set((members || []).map((x) => x.community_id));
  const categories = [
    ...new Set((data || []).map((c) => c.category).filter(Boolean)),
  ];
  page.innerHTML = `<div class="pageHead modernPageHead"><div><div class="eyebrow">COMMUNITY NETWORK</div><h1>Find your people.</h1><p>Join communities, share knowledge, collaborate and grow with developers.</p></div><button class="primary" onclick="openCommunityModal()">+ Create Community</button></div><div class="communityExplore"><div class="searchBox"><span>⌕</span><input id="allCommunitySearch" placeholder="Search communities..."><select id="allCommunityCategory"><option value="">All Categories</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div><div class="communityChips"><button class="chip active" data-category="">All</button>${categories.map((c) => `<button class="chip" data-category="${esc(c)}">${esc(c)}</button>`).join("")}</div><div class="communityGrid pageGrid" id="allCommunitiesGrid">${(data || []).map((c) => communityCard(c, joinedIds)).join("") || empty("No communities", "Create the first one.")}</div></div>`;
  const input = document.querySelector("#allCommunitySearch"),
    select = document.querySelector("#allCommunityCategory"),
    chips = [...document.querySelectorAll(".chip")];
  const apply = () => {
    const term = input.value.trim().toLowerCase(),
      cat = select.value;
    const rows = (data || []).filter((c) => {
      const hay =
        `${c.name || ""} ${c.description || ""} ${c.category || ""}`.toLowerCase();
      return (!term || hay.includes(term)) && (!cat || c.category === cat);
    });
    document.querySelector("#allCommunitiesGrid").innerHTML =
      rows.map((c) => communityCard(c, joinedIds)).join("") ||
      empty("No matches", "Try another search.");
    chips.forEach((b) =>
      b.classList.toggle("active", b.dataset.category === cat),
    );
  };
  input.oninput = apply;
  select.onchange = apply;
  chips.forEach(
    (b) =>
      (b.onclick = () => {
        select.value = b.dataset.category;
        apply();
      }),
  );
}

async function renderMyCommunities(page) {
  const [membersQ, createdQ] = await Promise.all([
    supabase
      .from("community_members")
      .select("community_id,community:communities(*)")
      .eq("user_id", state.session.user.id),
    supabase
      .from("communities")
      .select("*")
      .eq("creator_id", state.session.user.id),
  ]);
  if (membersQ.error || createdQ.error) throw membersQ.error || createdQ.error;
  const map = new Map();
  (membersQ.data || []).forEach((x) => {
    if (x.community) map.set(x.community.id, x.community);
  });
  (createdQ.data || []).forEach((c) => map.set(c.id, c));
  const communities = [...map.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );
  page.innerHTML = `<div class="pageHead modernPageHead"><div><div class="eyebrow">MY COMMUNITIES</div><h1>Your workspace</h1><p>Everything you joined or built, in one place.</p></div><button class="primary" onclick="openCommunityModal()">+ Create Community</button></div><div class="myCommunityGrid">${communities.map((c) => `<article class="myCommunityCard" onclick="location.hash='community?id=${c.id}'"><div class="myCommunityCover" style="${c.banner_url ? `background-image:url('${esc(c.banner_url)}')` : ""}"></div><div class="myCommunityBody">${image(c.logo_url, c.name, "communityIcon")}<div class="myCommunityInfo"><h3>${esc(c.name)}</h3><p>${esc(c.description || "Build together.")}</p><div class="communityMiniMeta"><span>${c.member_count || 0} members</span><span>${c.view_count || 0} views</span><span>${esc(c.remote_mode || "Remote")}</span></div></div></div></article>`).join("") || empty("No communities yet", "Join a community from Explore or create your own.")}</div>`;
}
async function renderProfile(page, id) {
  if (!id)
    return (page.innerHTML = empty(
      "Profile not found",
      "No user was selected.",
    ));
  const p = await profile(id);
  if (!p)
    return (page.innerHTML = empty(
      "Profile not found",
      "This developer does not exist.",
    ));
  const results = await Promise.all([
    supabase
      .from("follows")
      .select("following_id", { count: "exact", head: true })
      .eq("following_id", id),
    supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("follower_id", id),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", id),
    supabase
      .from("projects")
      .select("*,community:communities(id,name,logo_url)")
      .eq("owner_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("community_members")
      .select("community:communities(id,name,logo_url,description)")
      .eq("user_id", id),
    getPosts({ author: id }),
  ]);
  const [followersQ, followingQ, postsQ, projects, memberRows, posts] = results;
  const firstError = [
    followersQ,
    followingQ,
    postsQ,
    projects,
    memberRows,
  ].find((r) => r?.error)?.error;
  if (firstError)
    return (page.innerHTML = empty("Profile unavailable", firstError.message));
  const followers = followersQ.count || 0,
    following = followingQ.count || 0,
    postCount = postsQ.count || 0;

  // Profile content is grouped into the same three publishing types used by Home.
  // A one-page item is a Post, a multi-page item is a Blog, and an explicit reel is a Reel.
  const classifyProfileContent = (items) => {
    const grouped = { post: [], blog: [], reel: [] };
    (items || []).forEach((item) => {
      const pages = Array.isArray(item.body_pages) ? item.body_pages : [];
      const type =
        item.post_type === "reel" ? "reel" : pages.length > 1 ? "blog" : "post";
      grouped[type].push(item);
    });
    return grouped;
  };
  const profileContent = classifyProfileContent(posts);
  const renderProfileCards = async (items, emptyTitle, emptyText) =>
    (await Promise.all((items || []).map(postCard))).join("") ||
    empty(emptyTitle, emptyText);
  const profilePostCards = await renderProfileCards(
    profileContent.post,
    "No posts yet",
    "This developer has not published a one-page post.",
  );
  const profileBlogCards = await renderProfileCards(
    profileContent.blog,
    "No blogs yet",
    "This developer has not published a multi-page blog.",
  );
  const profileReelCards = await renderProfileCards(
    profileContent.reel,
    "No reels yet",
    "This developer has not published a reel.",
  );
  const own = id === state.session.user.id;
  let isFollowing = false;
  if (!own) {
    const { data } = await supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", state.session.user.id)
      .eq("following_id", id)
      .maybeSingle();
    isFollowing = !!data;
  }
  page.innerHTML = `<section class="profileHeader"><div class="profileAvatarWrap">${image(p.avatar_url, p.display_name || p.full_name || p.username, "profileAvatar")}</div><div class="profileIdentity"><div class="eyebrow">@${esc(p.username)}</div><h1>${esc(p.display_name || p.full_name || "Developer")}</h1><p>${esc(p.bio || "Building things and solving problems.")}</p>${p.location ? `<div class="profileLocation">⌖ ${esc(p.location)}</div>` : ""}<div class="profileStats"><button onclick="openPeopleList('${id}','followers')"><b>${followers}</b><span>followers</span></button><button onclick="openPeopleList('${id}','following')"><b>${following}</b><span>following</span></button><span><b>${postCount}</b><span>posts</span></span></div></div><div class="profileActions">${own ? `<button class="primary" onclick="openProfileModal()">Edit profile</button>` : `<button class="${isFollowing ? "secondary" : "primary"}" onclick="toggleFollow('${id}',${isFollowing})">${isFollowing ? "Unfollow" : "Follow"}</button><button class="secondary" onclick="messageUser('${id}')">Message</button>`}</div></section><div class="profileGrid"><section><div class="card"><h2>About</h2><p>${esc(p.bio || "No bio yet.")}</p>${p.location ? `<p class="profileLocation">⌖ ${esc(p.location)}</p>` : ""}<h3>Skills</h3><div class="tags">${(p.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join("") || "<span class='muted'>No skills listed.</span>"}</div></div><div class="card"><div class="sectionTitle"><h2>Projects</h2>${own ? `<button class="secondary" onclick="openProjectModal()">+ Add project</button>` : ""}</div><div class="projectList">${(projects.data || []).map(projectCard).join("") || `<p class="muted">${own ? "Add your projects here." : "No projects added yet."}</p>`}</div></div><div class="card profileContentCard">
  <div class="profileContentTabs" role="tablist" aria-label="Profile content">
    <button class="profileContentTab active" type="button" role="tab" aria-selected="true" data-profile-content="post" onclick="switchProfileContent('post')">Posts</button>
    <button class="profileContentTab" type="button" role="tab" aria-selected="false" data-profile-content="blog" onclick="switchProfileContent('blog')">Blogs</button>
    <button class="profileContentTab" type="button" role="tab" aria-selected="false" data-profile-content="reel" onclick="switchProfileContent('reel')">Reels</button>
  </div>
  <div class="profileContentPanel" data-profile-panel="post">${profilePostCards}</div>
  <div class="profileContentPanel hidden" data-profile-panel="blog">${profileBlogCards}</div>
  <div class="profileContentPanel hidden" data-profile-panel="reel">${profileReelCards}</div>
</div></section><aside><div class="card"><h3>Communities & projects</h3><div class="peopleList">${(memberRows.data || []).map((x) => (x.community ? `<button class="memberRow" onclick="location.hash='community?id=${x.community.id}'">${image(x.community.logo_url, x.community.name, "avatar")}<span><b>${esc(x.community.name)}</b><small>Joined community</small></span></button>` : " ")).join("") || `<p class="muted">No community links yet.</p>`}</div></div><div class="card"><h3>Links</h3>${linkLine("GitHub", p.github_url)}${linkLine("LinkedIn", p.linkedin_url)}${linkLine("Portfolio", p.portfolio_url)}${linkLine("Website", p.website_url)}</div></aside></div>`;
}
function switchProfileContent(type = "post") {
  const allowed = new Set(["post", "blog", "reel"]);
  if (!allowed.has(type)) type = "post";
  document.querySelectorAll("[data-profile-content]").forEach((tab) => {
    const active = tab.dataset.profileContent === type;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-profile-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.profilePanel !== type);
  });
}
window.switchProfileContent = switchProfileContent;

function personRow(u, isFollowing = false) {
  if (!u) return "";
  const name = u.display_name || u.full_name || u.username || "Developer";
  const safeFollowing = !!isFollowing;
  return `<div class="memberRow personRow" data-user-id="${u.id}">
    <button class="personRowIdentity" type="button" onclick="location.hash='user?id=${u.id}'">
      ${image(u.avatar_url, name)}
      <span><b>${esc(name)}</b><small>@${esc(u.username || "")}</small></span>
    </button>
    ${u.id !== state.session.user.id ? `<button type="button" class="personFollowBtn ${safeFollowing ? "secondary" : "primary"}" data-following="${safeFollowing ? "true" : "false"}" onclick="event.stopPropagation(); toggleFollowInPlace('${u.id}', this)">${safeFollowing ? "Unfollow" : "Follow"}</button>` : ""}
  </div>`;
}
function projectCard(x) {
  return `<div class="projectCard"><div><h3>${esc(x.name)}</h3><p>${esc(x.description || "")}</p><div class="tags">${(x.technologies || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>${x.community ? `<button class="communityLink" onclick="location.hash='community?id=${x.community.id}'">${esc(x.community.name)}</button>` : ""}</div>${x.url ? `<a target="_blank" rel="noreferrer" href="${esc(x.url)}">Open</a>` : ""}</div>`;
}
function linkLine(label, url) {
  return url
    ? `<a class="linkLine" target="_blank" rel="noreferrer" href="${esc(url)}">${esc(label)} ↗</a>`
    : "";
}

async function openPeopleList(userId, type) {
  const col = type === "followers" ? "follower_id" : "following_id",
    match = type === "followers" ? "following_id" : "follower_id";
  const { data, error } = await supabase
    .from("follows")
    .select(
      `${col},created_at,user:profiles!follows_${col}_fkey(id,username,display_name,full_name,avatar_url)`,
    )
    .eq(match, userId)
    .order("created_at", { ascending: false });
  if (error) return toast(error.message, "error");

  const people = (data || []).map((x) => x.user).filter(Boolean);
  let followingIds = new Set();
  if (people.length && state.session?.user?.id) {
    const { data: mine } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", state.session.user.id)
      .in(
        "following_id",
        people.map((u) => u.id),
      );
    followingIds = new Set((mine || []).map((x) => x.following_id));
  }

  modal(
    `<h2>${type === "followers" ? "Followers" : "Following"}</h2><div class="peopleList">${people.map((u) => personRow(u, followingIds.has(u.id))).join("") || `<p class="muted">No ${type} yet.</p>`}</div>`,
  );
}
window.openPeopleList = openPeopleList;

async function toggleFollowInPlace(id, button) {
  if (!id || id === state.session.user.id || button.disabled) return;
  const currentlyFollowing = button.dataset.following === "true";
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = currentlyFollowing ? "Unfollowing…" : "Following…";
  try {
    const action = currentlyFollowing
      ? supabase
          .from("follows")
          .delete()
          .eq("follower_id", state.session.user.id)
          .eq("following_id", id)
      : supabase
          .from("follows")
          .insert({ follower_id: state.session.user.id, following_id: id });
    const { error } = await action;
    if (error) throw error;
    const next = !currentlyFollowing;
    button.dataset.following = next ? "true" : "false";
    button.textContent = next ? "Unfollow" : "Follow";
    button.classList.toggle("primary", !next);
    button.classList.toggle("secondary", next);
    toast(next ? "Following." : "Unfollowed.", "success");
  } catch (err) {
    button.textContent = previousText;
    toast(err.message || "Could not update follow status.", "error");
  } finally {
    button.disabled = false;
  }
}
window.toggleFollowInPlace = toggleFollowInPlace;

async function toggleFollow(id, following) {
  const action = following
    ? supabase
        .from("follows")
        .delete()
        .eq("follower_id", state.session.user.id)
        .eq("following_id", id)
    : supabase
        .from("follows")
        .insert({ follower_id: state.session.user.id, following_id: id });
  const { error } = await action;
  if (error) toast(error.message, "error");
  else {
    toast(following ? "Unfollowed." : "Following.", "success");
    navigate(`user?id=${id}`);
  }
}
window.toggleFollow = toggleFollow;

async function messageUser(otherId) {
  if (otherId === state.session.user.id)
    return toast("You cannot message yourself.", "error");
  const { data, error } = await supabase.rpc(
    "get_or_create_direct_conversation",
    { other_user_id: otherId },
  );
  if (error) return toast(error.message, "error");
  location.hash = `messages?conversation=${data}`;
}
window.messageUser = messageUser;

async function refreshCommunityChat(
  id,
  channelId = state.selectedCommunityChannel,
) {
  let query = supabase
    .from("community_messages")
    .select(
      "*,sender:profiles!community_messages_sender_id_fkey(username,display_name,full_name,avatar_url)",
    )
    .eq("community_id", id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (channelId) query = query.eq("channel_id", channelId);
  const { data, error } = await query;
  if (error) {
    toast(error.message, "error");
    return;
  }
  const chat = document.querySelector("#communityChat");
  if (!chat) return;
  chat.innerHTML =
    (data || [])
      .map((m) => {
        const own = m.sender_id === state.session.user.id,
          deleted = !!m.deleted_at;
        const attachment = m.attachment_url
          ? `<a class="messageAttachment" href="${esc(m.attachment_url)}" target="_blank" rel="noreferrer">📎 ${esc(m.attachment_name || "Attachment")}</a>`
          : "";
        const voice = m.voice_url
          ? `<audio class="voicePlayer" controls src="${esc(m.voice_url)}"></audio>${m.voice_duration_seconds ? `<small class="voiceDuration">${m.voice_duration_seconds}s</small>` : ""}`
          : "";
        const body = deleted
          ? `<span class="messageDeleted">Message unsent</span>`
          : `${m.content ? `<div>${esc(m.content)}</div>` : ""}${attachment}${voice}`;
        return `<div class="workspaceMessage ${own ? "mine" : ""}">${image(m.sender?.avatar_url, m.sender?.display_name || m.sender?.username, "avatar tiny")}<div class="workspaceMessageBody"><div class="workspaceMessageMeta"><b>${esc(m.sender?.display_name || m.sender?.username)}</b><small>${timeAgo(m.created_at)}</small>${own && !deleted ? `<button class="messageMenuBtn" title="Unsend" onclick="unsendCommunityMessage('${m.id}','${id}','${channelId || ""}')">⋯</button>` : ""}</div><div class="workspaceBubble ${deleted ? "deleted" : ""}">${body}</div></div></div>`;
      })
      .join("") ||
    `<div class="chatEmpty"><div>💬</div><p>No messages in this channel yet.</p><small>Be the first to start the conversation.</small></div>`;
  chat.scrollTop = chat.scrollHeight;
}
window.refreshCommunityChat = refreshCommunityChat;

async function ensureCommunityChannels(id) {
  const { data, error } = await supabase.rpc(
    "ensure_default_community_channels",
    { community_id_input: id },
  );
  if (error) throw error;
  return data || [];
}

async function renderCommunityOverview(page, id) {
  if (!id)
    return (page.innerHTML = empty(
      "Community not found",
      "Choose a community from Explore.",
    ));
  const { data: c, error } = await supabase
    .from("communities")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !c)
    return (page.innerHTML = empty(
      "Community not found",
      "This community is unavailable.",
    ));
  await supabase.rpc("record_community_view", { community_id_input: id });
  if (c?.category) trackInterest("community_category", c.category);
  const [membersQ, membershipQ, applicationQ, eventsQ, filesQ] =
    await Promise.all([
      supabase
        .from("community_members")
        .select(
          "*,user:profiles!community_members_user_id_fkey(id,username,display_name,full_name,avatar_url,bio,skills)",
        )
        .eq("community_id", id)
        .order("joined_at", { ascending: true }),
      supabase
        .from("community_members")
        .select("role")
        .eq("community_id", id)
        .eq("user_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_applications")
        .select("status")
        .eq("community_id", id)
        .eq("applicant_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_events")
        .select("*")
        .eq("community_id", id)
        .order("starts_at", { ascending: true })
        .limit(4),
      supabase
        .from("community_files")
        .select(
          "*,uploader:profiles!community_files_uploader_id_fkey(display_name,username,avatar_url)",
        )
        .eq("community_id", id)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
  const joined = !!membershipQ.data || c.creator_id === state.session.user.id;
  const creator = c.creator_id === state.session.user.id;
  const categories = [
    "Web Development",
    "Mobile Development",
    "AI & Machine Learning",
    "Data Science",
    "Cybersecurity",
    "Cloud & DevOps",
    "Game Development",
    "Blockchain & Web3",
    "Open Source",
    "UI/UX & Design",
    "Startups & Founders",
    "Programming Languages",
    "Career & Jobs",
    "Freelancing",
    "Robotics & IoT",
    "No-Code & Automation",
  ];
  page.innerHTML = `<div class="communityOverview"><button class="back" onclick="history.back()">← Back to communities</button><div class="communityOverviewHero" ${c.banner_url ? `style="background-image:linear-gradient(90deg,rgba(4,10,20,.94),rgba(4,10,20,.35)),url('${esc(c.banner_url)}')"` : ""}><div>${image(c.logo_url, c.name, "communityIcon xxl")}</div><div class="communityOverviewIdentity"><span class="categoryPill">${esc(c.category || "Community")}</span><h1>${esc(c.name)}</h1><p>${esc(c.description || "A community for developers and builders.")}</p><div class="overviewStats"><span><b>${Number(c.member_count || 0).toLocaleString()}</b> members</span><span><b>${Number(c.view_count || 0).toLocaleString()}</b> views</span><span>${esc(c.remote_mode || "Remote")}</span><span>${esc(c.location || "Global")}</span></div></div></div><div class="communityOverviewGrid"><main><section class="overviewCard"><h2>About this community</h2><p>${esc(c.description || "No additional description yet.")}</p><div class="overviewTwoCol"><div><h3>What you'll find</h3><div class="tagCloud">${
    (c.required_skills || [])
      .map((s) => `<span class="tag">${esc(s)}</span>`)
      .join("") ||
    categories
      .slice(0, 4)
      .map((x) => `<span class="tag">${x}</span>`)
      .join("")
  }</div></div><div><h3>Community type</h3><p class="muted">${c.recruitment_enabled ? "Recruitment and collaboration enabled." : "Open developer discussion and collaboration."}</p><p class="muted">${esc(c.rules || "Be respectful, share useful work, and help other builders.")}</p></div></div></section><section class="overviewCard"><div class="sectionTitle"><div><h2>Members</h2><p class="muted">People building inside this community.</p></div><button class="linkButton" onclick="openPeopleListForCommunity('${id}')">View all →</button></div><div class="memberPreviewGrid">${
    (membersQ.data || [])
      .slice(0, 8)
      .map(
        (m) =>
          `<button class="memberPreview" onclick="location.hash='user?id=${m.user?.id}'">${image(m.user?.avatar_url, m.user?.display_name || m.user?.username, "avatar large")}<b>${esc(m.user?.display_name || m.user?.username || "Developer")}</b><small>@${esc(m.user?.username || "")}</small></button>`,
      )
      .join("") || `<p class="muted">No members yet.</p>`
  }</div></section><section class="overviewCard"><h2>Upcoming events</h2>${(eventsQ.data || []).map((e) => `<div class="resourceRow"><div class="resourceIcon">◷</div><div><b>${esc(e.title)}</b><small>${new Date(e.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div></div>`).join("") || `<p class="muted">No events scheduled yet.</p>`}</section></main><aside class="communityJoinRail"><section class="joinCard"><div class="joinCardTop"><span class="statusDot"></span><b>${joined ? "You're a member" : "Public community"}</b></div>${joined ? `<button class="primary full" onclick="location.hash='communityChat?id=${id}'">Open community</button>${!creator ? `<button class="secondary full" onclick="leaveCommunity('${id}')">Leave community</button>` : ""}` : applicationQ.data?.status === "pending" ? `<button class="secondary full" disabled>Application pending</button>` : `<button class="primary full" onclick="${c.recruitment_enabled ? `applyCommunity('${id}')` : `joinCommunity('${id}')`}">${c.recruitment_enabled ? "Apply to join" : "Join community"}</button>`}<div class="joinMeta"><span>✓ ${Number(c.member_count || 0).toLocaleString()} members</span><span>✓ ${esc(c.remote_mode || "Remote")}</span><span>✓ ${esc(c.category || "Developer community")}</span></div></section><section class="overviewCard compact"><h3>Community details</h3><div class="settingLine">◉ Public</div><div class="settingLine">♧ ${c.recruitment_enabled ? "Recruiting" : "No recruitment"}</div><div class="settingLine">⌖ ${esc(c.location || "Global")}</div><div class="settingLine">★ ${esc(c.category || "Community")}</div></section><section class="overviewCard compact"><h3>Recent resources</h3>${(filesQ.data || []).map((f) => `<a class="resourceRow" href="${esc(f.url)}" target="_blank" rel="noreferrer"><div class="resourceIcon">▣</div><div><b>${esc(f.name)}</b><small>${timeAgo(f.created_at)}</small></div></a>`).join("") || `<p class="muted">No resources yet.</p>`}</section></aside></div></div>`;
}

async function renderCommunityWorkspace(page, id) {
  const membership = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", id)
    .eq("user_id", state.session.user.id)
    .maybeSingle();
  const basic = await supabase
    .from("communities")
    .select("creator_id")
    .eq("id", id)
    .single();
  if (!membership.data && basic.data?.creator_id !== state.session.user.id)
    return renderCommunityOverview(page, id);
  const { data: c, error } = await supabase
    .from("communities")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !c)
    return (page.innerHTML = empty(
      "Community not found",
      "This community is unavailable.",
    ));
  await supabase.rpc("record_community_view", { community_id_input: id });
  if (c?.category) trackInterest("community_category", c.category);
  if (c.creator_id === state.session.user.id)
    await supabase.rpc("ensure_community_creator_membership", {
      community_id_input: id,
    });
  const channels = await ensureCommunityChannels(id);
  const [membersQ, membershipQ, applicationQ, eventsQ, filesQ] =
    await Promise.all([
      supabase
        .from("community_members")
        .select(
          "*,user:profiles!community_members_user_id_fkey(id,username,display_name,full_name,avatar_url)",
        )
        .eq("community_id", id)
        .order("joined_at", { ascending: true }),
      supabase
        .from("community_members")
        .select("role")
        .eq("community_id", id)
        .eq("user_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_applications")
        .select("status")
        .eq("community_id", id)
        .eq("applicant_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_events")
        .select("*")
        .eq("community_id", id)
        .order("starts_at", { ascending: true })
        .limit(5),
      supabase
        .from("community_files")
        .select(
          "*,uploader:profiles!community_files_uploader_id_fkey(display_name,username,avatar_url)",
        )
        .eq("community_id", id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
  const queryError = [
    membersQ,
    membershipQ,
    applicationQ,
    eventsQ,
    filesQ,
  ].find((x) => x.error)?.error;
  if (queryError)
    return (page.innerHTML = empty(
      "Community unavailable",
      queryError.message,
    ));
  const joined = !!membershipQ.data || c.creator_id === state.session.user.id;
  const creator = c.creator_id === state.session.user.id;
  state.selectedCommunityChannel =
    state.selectedCommunityChannel &&
    channels.some((x) => x.id === state.selectedCommunityChannel)
      ? state.selectedCommunityChannel
      : (channels.find((x) => x.slug === "general") || channels[0])?.id || null;
  const activeChannel =
    channels.find((x) => x.id === state.selectedCommunityChannel) ||
    channels[0];
  let messagesQ = supabase
    .from("community_messages")
    .select(
      "*,sender:profiles!community_messages_sender_id_fkey(username,display_name,full_name,avatar_url)",
    )
    .eq("community_id", id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (activeChannel?.id)
    messagesQ = messagesQ.eq("channel_id", activeChannel.id);
  const { data: messages, error: messagesError } = await messagesQ;
  if (messagesError)
    return (page.innerHTML = empty(
      "Community chat unavailable",
      messagesError.message,
    ));
  let directConvs = [];
  const cmQ = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", state.session.user.id)
    .limit(8);
  if (!cmQ.error && cmQ.data?.length) {
    const ids = cmQ.data.map((x) => x.conversation_id);
    const cv = await supabase
      .from("conversations")
      .select("*")
      .in("id", ids)
      .order("updated_at", { ascending: false })
      .limit(5);
    directConvs = cv.data || [];
  }
  const creatorMember = (membersQ.data || []).find((m) => m.role === "creator");
  page.innerHTML = `<div class="communityWorkspace">
    <div class="workspaceHeader">
      <button class="back workspaceBack" onclick="history.back()">← Back</button>
      <div class="workspaceHero" ${c.banner_url ? `style="background-image:linear-gradient(90deg,rgba(8,17,31,.72),rgba(8,17,31,.12)),url('${esc(c.banner_url)}')"` : ""}>
        ${image(c.logo_url, c.name, "workspaceCommunityLogo")}
        <div class="workspaceHeroText"><div class="eyebrow">${esc(c.category || "COMMUNITY")}</div><h1>${esc(c.name)} <span class="publicBadge">Public</span></h1><p>${esc(c.description || "Build together.")}</p><small>${c.member_count || 0} members · ${c.view_count || 0} views · Created ${timeAgo(c.created_at)} · ${esc(c.remote_mode || "Remote")}</small></div>
        <div class="workspaceHeroActions">${creator ? `<button class="secondary" onclick="openCommunityModal('${id}')">Edit</button>` : joined ? `<button class="secondary" onclick="leaveCommunity('${id}')">Leave</button>` : applicationQ.data?.status === "pending" ? `<button class="secondary" disabled>Application pending</button>` : `<button class="primary" onclick="applyCommunity('${id}')">Apply to join</button>`}</div>
      </div>
      <div class="workspaceTabs"><button class="workspaceTab active" data-tab="chat">▣ Chat</button></div>
    </div>
    <div class="workspaceBody">
      <aside class="workspaceLeft">
        <div class="workspaceSideTitle">Channels ${creator ? `<button class="channelAddBtn" title="Create channel" onclick="openCreateChannelModal('${id}')">＋</button>` : ""}</div>
        <div class="channelList">${channels.map((ch) => `<div class="channelItemWrap"><button class="channelItem ${ch.id === activeChannel?.id ? "active" : ""}" data-channel-id="${ch.id}" data-channel-name="${esc(ch.name)}" data-channel-topic="${esc(ch.topic || "")}" onclick="selectCommunityChannel('${id}','${ch.id}')"><span>#</span><span class="channelItemName">${esc(ch.name)}</span></button>${creator ? `<button class="channelDeleteBtn" title="Delete #${esc(ch.name)}" aria-label="Delete channel" onclick="deleteCommunityChannel(event,'${id}','${ch.id}')">×</button>` : ""}</div>`).join("")}</div>
        <div class="workspaceSideTitle dmTitle">Direct Messages <button onclick="location.hash='messages'">＋</button></div>
        <div class="communityDMList">${directConvs.length ? await communityDMRows(directConvs) : `<div class="sideMuted">No direct messages yet.</div>`}</div>
        <div class="workspaceUserCard">${image(state.profile?.avatar_url, state.profile?.display_name || state.profile?.username, "avatar")}<div><b>${esc(state.profile?.display_name || state.profile?.username || "Developer")}</b><small>@${esc(state.profile?.username || "")}</small></div><button onclick="location.hash='profile'">View Profile</button></div>
      </aside>
      <main class="workspaceCenter">
        <div class="channelHeader"><div><h2 id="activeChannelName"># ${esc(activeChannel?.name || "general")}</h2><small id="activeChannelTopic">${esc(activeChannel?.topic || "General discussion about ideas, startups and tech")}</small></div><div class="channelHeaderActions"><button class="iconBtn" title="Chat settings" onclick="openCommunityChatSettings('${id}','${activeChannel?.id || ""}')">⚙</button></div></div>
        <div class="workspaceChat" id="communityChat">${(messages || []).map((m) => `<div class="workspaceMessage ${m.sender_id === state.session.user.id ? "mine" : ""}">${image(m.sender?.avatar_url, m.sender?.display_name || m.sender?.username, "avatar tiny")}<div class="workspaceMessageBody"><div class="workspaceMessageMeta"><b>${esc(m.sender?.display_name || m.sender?.username)}</b><small>${timeAgo(m.created_at)}</small></div><div class="workspaceBubble">${esc(m.content)}</div></div></div>`).join("") || `<div class="chatEmpty"><div>💬</div><p>No messages in this channel yet.</p><small>Be the first to start the conversation.</small></div>`}</div>
        ${joined ? `<form id="communityChatForm" class="workspaceComposer"><input type="file" id="communityMessageFile" class="hidden" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"><button type="button" class="composerIcon" title="Attach file" onclick="document.querySelector('#communityMessageFile').click()">＋</button><button type="button" class="composerIcon" id="communityVoiceBtn" title="Record voice note" onclick="toggleCommunityVoiceRecording('${id}','${activeChannel?.id || ""}')">🎙</button><input name="message" autocomplete="off" placeholder="Message #${esc(activeChannel?.name || "general")}…"><button class="sendButton" aria-label="Send">➤</button></form>` : `<div class="joinChatNotice">Join the community to participate in chat.</div>`}
      </main>
      <aside class="workspaceRight">
        <section class="rightCard"><div class="rightTitle"><h3>Members (${membersQ.data?.length || 0})</h3><button class="linkButton" onclick="openPeopleListForCommunity('${id}')">View all</button></div><div class="memberRoster">${(
          membersQ.data || []
        )
          .slice(0, 8)
          .map(
            (m) =>
              `<button class="rosterRow" onclick="location.hash='user?id=${m.user?.id}'">${image(m.user?.avatar_url, m.user?.display_name || m.user?.username, "avatar small")}<span><b>${esc(m.user?.display_name || m.user?.username || "Developer")}</b><small>${esc(m.role || "member")} · ${m.user?.id === state.session.user.id ? "Online" : "Member"}</small></span>${m.role === "creator" ? `<em>♛</em>` : ""}</button>`,
          )
          .join("")}</div></section>
        <section class="rightCard"><h3>Community Settings</h3><div class="settingLine"><span>◉</span> Public Community</div><div class="settingLine"><span>♧</span> ${c.recruitment_enabled ? "Recruitment Enabled" : "Recruitment Closed"}</div><div class="settingLine"><span>◷</span> ${c.member_count || 0} Members</div><div class="settingLine"><span>⌖</span> ${esc(c.location || c.remote_mode || "Remote")}</div></section>
        <section class="rightCard"><div class="rightTitle"><h3>Upcoming Events</h3>${creator ? `<button class="linkButton" onclick="openCommunityEventModal('${id}')">+ Add</button>` : ""}</div>${(eventsQ.data || []).map((e) => `<div class="resourceRow"><div class="resourceIcon">◷</div><div><b>${esc(e.title)}</b><small>${new Date(e.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div></div>`).join("") || `<div class="sideMuted">No events scheduled.</div>`}</section>
        <section class="rightCard"><div class="rightTitle"><h3>Recent Files</h3>${joined ? `<button class="linkButton" onclick="openCommunityFileModal('${id}')">+ Add</button>` : ""}</div>${(filesQ.data || []).map((f) => `<a class="resourceRow" href="${esc(f.url)}" target="_blank" rel="noreferrer"><div class="resourceIcon">▣</div><div><b>${esc(f.name)}</b><small>${esc(f.uploader?.display_name || f.uploader?.username || "Member")} · ${timeAgo(f.created_at)}</small></div></a>`).join("") || `<div class="sideMuted">No shared files yet.</div>`}</section>
        ${creator && c.recruitment_enabled ? `<section class="rightCard" id="communityApplications"><h3>Recruitment</h3><p class="sideMuted">Loading applications…</p></section>` : ""}
      </aside>
    </div>
  </div>`;
  document
    .querySelector("#communityChat")
    ?.scrollTo({ top: 999999, behavior: "instant" });
  document
    .querySelector("#communityChatForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.message,
        fileInput = document.querySelector("#communityMessageFile"),
        button = e.target.querySelector(".sendButton");
      const text = input.value.trim(),
        file = fileInput?.files?.[0];
      if (!text && !file) return;
      button.disabled = true;
      try {
        let attachmentUrl = null,
          attachmentName = null,
          attachmentType = null;
        if (file) {
          const up = await uploadMessageFile(file, "community", id);
          attachmentUrl = up.url;
          attachmentName = up.name;
          attachmentType = up.type;
        }
        const { error } = await supabase.rpc("send_community_message", {
          community_id_input: id,
          channel_id_input: activeChannel?.id || null,
          content_input: text,
          attachment_url_input: attachmentUrl,
          attachment_name_input: attachmentName,
          attachment_type_input: attachmentType,
          voice_url_input: null,
        });
        if (error) throw error;
        input.value = "";
        if (fileInput) fileInput.value = "";
        await refreshCommunityChat(id, activeChannel?.id);
      } catch (err) {
        toast(err.message || "Could not send message.", "error");
      } finally {
        button.disabled = false;
      }
    });
  if (creator && c.recruitment_enabled) await loadCommunityApplications(id);
}

async function communityDMRows(convs) {
  const rows = [];
  for (const c of convs) {
    const { data: u } = await supabase
      .from("conversation_members")
      .select(
        "user:profiles!conversation_members_user_id_fkey(id,display_name,full_name,username,avatar_url)",
      )
      .eq("conversation_id", c.id)
      .neq("user_id", state.session.user.id)
      .limit(1)
      .maybeSingle();
    const user = u?.user;
    if (user)
      rows.push(
        `<button class="dmRow" onclick="location.hash='messages?conversation=${c.id}'">${image(user.avatar_url, user.display_name || user.username, "avatar small")}<span><b>${esc(user.display_name || user.username)}</b><small>Direct message</small></span></button>`,
      );
  }
  return (
    rows.join("") || `<div class="sideMuted">No direct messages yet.</div>`
  );
}
window.selectCommunityChannel = async function (id, channelId) {
  state.selectedCommunityChannel = channelId;
  document
    .querySelectorAll(".channelItem")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.channelId === channelId),
    );
  const active = document.querySelector(
    `.channelItem[data-channel-id="${channelId}"]`,
  );
  const name = active?.dataset.channelName || "general";
  const topic =
    active?.dataset.channelTopic ||
    "General discussion about ideas, startups and tech";
  const h = document.querySelector("#activeChannelName");
  if (h) h.textContent = `# ${name}`;
  const t = document.querySelector("#activeChannelTopic");
  if (t) t.textContent = topic;
  await refreshCommunityChat(id, channelId);
};

async function isCommunityCreator(id) {
  const { data } = await supabase
    .from("communities")
    .select("creator_id")
    .eq("id", id)
    .single();
  return data?.creator_id === state.session.user.id;
}
window.openCommunityPostModal = async function (communityId) {
  modal(
    `<h2>New community post</h2><form id="communityPostForm"><label>Title<input name="title" required maxlength="180"></label><label>Content<textarea name="content" required rows="7"></textarea></label><button class="primary full">Publish</button></form>`,
  );
  document.querySelector("#communityPostForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase.from("community_posts").insert({
      community_id: communityId,
      author_id: state.session.user.id,
      title: String(f.get("title")),
      content: String(f.get("content")),
    });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Community post published.", "success");
      await switchCommunityTab(communityId, "posts");
    }
  };
};

window.openPeopleListForCommunity = async function (id) {
  const { data } = await supabase
    .from("community_members")
    .select(
      "user:profiles!community_members_user_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .eq("community_id", id)
    .order("joined_at", { ascending: true });
  modal(
    `<h2>Community members</h2><div class="peopleList">${(data || []).map((x) => personRow(x.user)).join("") || `<p class="muted">No members yet.</p>`}</div>`,
  );
};

window.leaveCommunity = async (id) => {
  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", id)
    .eq("user_id", state.session.user.id);
  if (error) toast(error.message, "error");
  else navigate(`community?id=${id}`);
};
window.applyCommunity = async (id) => {
  const { error } = await supabase.from("community_applications").insert({
    community_id: id,
    applicant_id: state.session.user.id,
    answers: {},
  });
  if (error) toast(error.message, "error");
  else {
    toast("Application sent.", "success");
    navigate(`community?id=${id}`);
  }
};

async function loadCommunityApplications(communityId) {
  const root = document.querySelector("#communityApplications");
  if (!root) return;
  const { data, error } = await supabase
    .from("community_applications")
    .select(
      "id,status,answers,created_at,applicant:profiles!community_applications_applicant_id_fkey(id,username,display_name,full_name,avatar_url,location)",
    )
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });
  if (error) {
    root.innerHTML = `<h2>Recruitment applications</h2><p class="muted">${esc(error.message)}</p>`;
    return;
  }
  root.innerHTML = `<h2>Recruitment applications</h2>${(data || []).map((a) => `<div class="communityApplication">${personRow(a.applicant)}<small class="muted">${esc(a.status)} · ${timeAgo(a.created_at)}</small>${a.status === "pending" ? `<div class="appActions"><button class="primary" onclick="reviewCommunityApplication('${a.id}','${communityId}','accepted')">Accept</button><button class="secondary" onclick="reviewCommunityApplication('${a.id}','${communityId}','rejected')">Reject</button></div>` : ""}</div>`).join("") || `<p class="muted">No applications yet.</p>`}`;
}
window.reviewCommunityApplication = async function (
  applicationId,
  communityId,
  status,
) {
  let error = null;
  if (status === "accepted") {
    const r = await supabase.rpc("accept_community_application", {
      application_id_input: applicationId,
    });
    error = r.error;
  } else {
    const r = await supabase
      .from("community_applications")
      .update({
        status,
        reviewed_by: state.session.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)
      .eq("community_id", communityId);
    error = r.error;
  }
  if (error) return toast(error.message, "error");
  toast(
    status === "accepted"
      ? "Applicant accepted and added to the community."
      : "Application rejected.",
    "success",
  );
  await renderCommunityWorkspace(document.querySelector("#page"), communityId);
};

async function renderMessages(page) {
  const { data: members } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", state.session.user.id);
  const ids = (members || []).map((x) => x.conversation_id);
  let convs = [];
  if (ids.length) {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    convs = data || [];
  }
  page.innerHTML = `<div class="pageHead"><div><div class="eyebrow">MESSAGES</div><h1>Direct messages</h1><p>Private conversations with developers.</p></div></div><div class="messagesLayout"><aside class="conversationList">${await conversationList(convs)}</aside><section class="chatPanel" id="chatPanel">${state.selectedConversation ? "Loading…" : empty("No conversation selected", "Open a developer profile and choose Message.")}</section></div>`;
  if (state.selectedConversation) await loadChat(state.selectedConversation);
}
async function conversationList(convs) {
  if (!convs.length)
    return empty(
      "No messages",
      "Start a conversation from a developer profile.",
    );
  const html = [];
  for (const c of convs) {
    const { data: other } = await supabase
      .from("conversation_members")
      .select(
        "user:profiles!conversation_members_user_id_fkey(id,username,display_name,full_name,avatar_url)",
      )
      .eq("conversation_id", c.id)
      .neq("user_id", state.session.user.id)
      .limit(1)
      .maybeSingle();
    const { data: last } = await supabase
      .from("messages")
      .select("content,created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const u = other?.user;
    html.push(
      `<button class="conversationRow ${state.selectedConversation === c.id ? "active" : ""}" onclick="location.hash='messages?conversation=${c.id}'">${image(u?.avatar_url, u?.display_name || u?.full_name || u?.username)}<span><b>${esc(u?.display_name || u?.username || "Developer")}</b><small>${esc(last?.content || "No messages yet")}</small></span><time>${last ? timeAgo(last.created_at) : ""}</time></button>`,
    );
  }
  return html.join("");
}
async function fetchDirectMessages(id) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "*,sender:profiles!messages_sender_id_fkey(display_name,username,avatar_url)",
    )
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}
function directMessageMarkup(messages, id) {
  return (
    (messages || [])
      .map((m) => {
        const own = m.sender_id === state.session.user.id,
          deleted = !!m.deleted_at;
        const attachment = m.attachment_url
          ? `<a class="messageAttachment" href="${esc(m.attachment_url)}" target="_blank" rel="noreferrer">📎 ${esc(m.attachment_name || "Attachment")}</a>`
          : "";
        const voice = m.voice_url
          ? `<audio class="voicePlayer" controls src="${esc(m.voice_url)}"></audio>`
          : "";
        const body = deleted
          ? `<span class="messageDeleted">Message unsent</span>`
          : `${m.content ? `<div>${esc(m.content)}</div>` : ""}${attachment}${voice}`;
        return `<div class="igMessage ${own ? "mine" : ""}"><div class="bubble ${deleted ? "deleted" : ""}">${body}${own && !deleted ? `<button class="messageMenuBtn" title="Unsend message" onclick="unsendDirectMessage('${m.id}','${id}')">Unsend</button>` : ""}<small>${timeAgo(m.created_at)}</small></div></div>`;
      })
      .join("") ||
    `<div class="chatEmpty"><div>💬</div><p>No messages yet.</p><small>Start the conversation.</small></div>`
  );
}
async function refreshDirectMessages(id, keepBottom = true) {
  const box = document.querySelector("#chatMessages");
  if (!box) return loadChat(id);
  try {
    const messages = await fetchDirectMessages(id);
    box.innerHTML = directMessageMarkup(messages, id);
    if (keepBottom) box.scrollTop = box.scrollHeight;
  } catch (err) {
    toast(err.message || "Could not refresh messages.", "error");
  }
}
async function loadChat(id) {
  const panel = document.querySelector("#chatPanel");
  if (!panel) return;
  try {
    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", id);
    const otherId = (members || [])
      .map((x) => x.user_id)
      .find((x) => x !== state.session.user.id);
    const other = otherId ? await profile(otherId) : null;
    const messages = await fetchDirectMessages(id);
    const currentInput =
      document.querySelector("#chatForm input[name=message]")?.value ||
      state.messageDrafts[id] ||
      "";
    panel.innerHTML = `<div class="chatHeader">${image(other?.avatar_url, other?.display_name || other?.username)}<div><b>${esc(other?.display_name || other?.username || "Developer")}</b><small>@${esc(other?.username || "")}</small></div><button class="iconBtn chatSettingsBtn" title="Chat settings" onclick="openDirectChatSettings('${id}')">⚙</button></div><div class="chatMessages" id="chatMessages">${directMessageMarkup(messages, id)}</div><form id="chatForm" class="chatComposer"><input type="file" id="directMessageFile" class="hidden" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"><button type="button" class="composerIcon" title="Attach file" onclick="document.querySelector('#directMessageFile').click()">＋</button><button type="button" class="composerIcon" id="directVoiceBtn" title="Record voice note" onclick="toggleDirectVoiceRecording('${id}')">🎙</button><input name="message" autocomplete="off" placeholder="Message…" value="${esc(currentInput)}"><button class="primary">Send</button></form>`;
    const cm = document.querySelector("#chatMessages");
    cm.scrollTop = cm.scrollHeight;
    const form = document.querySelector("#chatForm"),
      input = form.querySelector("input[name=message]"),
      fileInput = document.querySelector("#directMessageFile");
    input.oninput = () => (state.messageDrafts[id] = input.value);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim(),
        file = fileInput?.files?.[0];
      if (!text && !file) return;
      const send = e.target.querySelector("button.primary");
      send.disabled = true;
      try {
        let attachmentUrl = null,
          attachmentName = null,
          attachmentType = null;
        if (file) {
          const up = await uploadMessageFile(file, "direct", id);
          attachmentUrl = up.url;
          attachmentName = up.name;
          attachmentType = up.type;
        }
        const { error } = await supabase.rpc("send_direct_message", {
          conversation_id_input: id,
          content_input: text,
          attachment_url_input: attachmentUrl,
          attachment_name_input: attachmentName,
          attachment_type_input: attachmentType,
          voice_url_input: null,
        });
        if (error) throw error;
        input.value = "";
        state.messageDrafts[id] = "";
        if (fileInput) fileInput.value = "";
        await refreshDirectMessages(id, true);
      } catch (err) {
        toast(err.message || "Could not send message.", "error");
      } finally {
        send.disabled = false;
        input.focus();
      }
    };
    await supabase
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", id)
      .eq("user_id", state.session.user.id);
  } catch (err) {
    panel.innerHTML = empty(
      "Could not open conversation",
      err.message || "Please try again.",
    );
  }
}

async function uploadMessageFile(file, scope, entityId) {
  const max = 20 * 1024 * 1024;
  if (!file || file.size > max)
    throw new Error("File must be 20 MB or smaller.");
  const safe = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${state.session.user.id}/${scope}/${entityId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from("message-media")
    .upload(path, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
    });
  if (error) throw error;
  return {
    url: supabase.storage.from("message-media").getPublicUrl(path).data
      .publicUrl,
    name: file.name || safe,
    type: file.type || "application/octet-stream",
  };
}
async function recordAndSendVoice({ scope, entityId, channelId = null }) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error("Voice recording is not supported in this browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      stream.getTracks().forEach((t) => t.stop());
      reject(e.error || new Error("Recording failed."));
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        const blob = new Blob(chunks, { type: mime });
        const file = new File([blob], `voice-${Date.now()}.webm`, {
          type: mime,
        });
        const up = await uploadMessageFile(file, scope, entityId);
        const voiceUrl = up.url;
        const duration = Math.max(1, Math.round((Date.now() - started) / 1000));
        let r;
        if (scope === "community")
          r = await supabase.rpc("send_community_message", {
            community_id_input: entityId,
            channel_id_input: channelId,
            content_input: "",
            attachment_url_input: null,
            attachment_name_input: null,
            attachment_type_input: null,
            voice_url_input: voiceUrl,
            voice_duration_input: duration,
          });
        else
          r = await supabase.rpc("send_direct_message", {
            conversation_id_input: entityId,
            content_input: "",
            attachment_url_input: null,
            attachment_name_input: null,
            attachment_type_input: null,
            voice_url_input: voiceUrl,
            voice_duration_input: duration,
          });
        if (r.error) throw r.error;
        resolve(duration);
      } catch (err) {
        reject(err);
      }
    };
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, 60000);
    window.__activeRecorder = recorder;
  });
}
window.toggleCommunityVoiceRecording = async function (id, channelId) {
  const btn = document.querySelector("#communityVoiceBtn");
  if (window.__activeRecorder?.state === "recording") {
    window.__activeRecorder.stop();
    return;
  }
  try {
    if (btn) btn.textContent = "⏹";
    await recordAndSendVoice({ scope: "community", entityId: id, channelId });
    await refreshCommunityChat(id, channelId);
  } catch (err) {
    toast(err.message || "Could not record voice note.", "error");
  } finally {
    if (btn) btn.textContent = "🎙";
    window.__activeRecorder = null;
  }
};
window.toggleDirectVoiceRecording = async function (id) {
  const btn = document.querySelector("#directVoiceBtn");
  if (window.__activeRecorder?.state === "recording") {
    window.__activeRecorder.stop();
    return;
  }
  try {
    if (btn) btn.textContent = "⏹";
    await recordAndSendVoice({ scope: "direct", entityId: id });
    await loadChat(id);
  } catch (err) {
    toast(err.message || "Could not record voice note.", "error");
  } finally {
    if (btn) btn.textContent = "🎙";
    window.__activeRecorder = null;
  }
};
window.unsendCommunityMessage = async function (
  messageId,
  communityId,
  channelId,
) {
  const { error } = await supabase.rpc("unsend_community_message", {
    message_id_input: messageId,
  });
  if (error) toast(error.message, "error");
  else
    await refreshCommunityChat(
      communityId,
      channelId || state.selectedCommunityChannel,
    );
};
window.unsendDirectMessage = async function (messageId, conversationId) {
  const { error } = await supabase.rpc("unsend_direct_message", {
    message_id_input: messageId,
  });
  if (error) toast(error.message, "error");
  else await loadChat(conversationId);
};
window.openCommunityChatSettings = function (communityId, channelId) {
  modal(
    `<h2>Chat settings</h2><p class="muted">Delete this channel's chat history from your view.</p><button class="danger full" onclick="clearCommunityChatHistory('${communityId}','${channelId}')">Delete chat history</button>`,
  );
};
window.clearCommunityChatHistory = async function (communityId, channelId) {
  const { error } = await supabase.rpc("clear_community_chat_history", {
    community_id_input: communityId,
    channel_id_input: channelId,
  });
  if (error) return toast(error.message, "error");
  closeModal();
  toast("Chat history cleared for you.", "success");
  await refreshCommunityChat(communityId, channelId);
};
window.openDirectChatSettings = function (conversationId) {
  modal(
    `<h2>Chat settings</h2><p class="muted">This clears the conversation from your view only.</p><button class="danger full" onclick="clearDirectChatHistory('${conversationId}')">Delete chat history</button>`,
  );
};
window.clearDirectChatHistory = async function (conversationId) {
  const { error } = await supabase.rpc("clear_direct_chat_history", {
    conversation_id_input: conversationId,
  });
  if (error) return toast(error.message, "error");
  closeModal();
  toast("Chat history cleared for you.", "success");
  await loadChat(conversationId);
};
window.openCreateChannelModal = function (communityId) {
  modal(
    `<h2>Create channel</h2><form id="channelCreateForm"><label>Channel name<input name="name" required maxlength="50" placeholder="design-review"></label><label>Topic<input name="topic" maxlength="120" placeholder="What is this channel for?"></label><button class="primary full">Create channel</button></form>`,
  );
  document.querySelector("#channelCreateForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      b = e.target.querySelector("button");
    b.disabled = true;
    try {
      const { error } = await supabase.rpc("create_community_channel", {
        community_id_input: communityId,
        name_input: String(f.get("name")),
        topic_input: String(f.get("topic") || ""),
      });
      if (error) throw error;
      closeModal();
      toast("Channel created.", "success");
      await renderCommunityWorkspace(
        document.querySelector("#page"),
        communityId,
      );
    } catch (err) {
      toast(err.message || "Could not create channel.", "error");
    } finally {
      b.disabled = false;
    }
  };
};
window.deleteCommunityChannel = async function (event, communityId, channelId) {
  event?.preventDefault();
  event?.stopPropagation();
  const wrap = event?.currentTarget?.closest(".channelItemWrap");
  const channelName =
    wrap?.querySelector(".channelItemName")?.textContent?.trim() ||
    "this channel";
  if (
    !confirm(
      `Delete #${channelName}?\n\nThis removes the channel and its chat history for everyone. This cannot be undone.`,
    )
  )
    return;
  const button = event?.currentTarget;
  if (button) button.disabled = true;
  try {
    const { error } = await supabase.rpc("delete_community_channel", {
      community_id_input: communityId,
      channel_id_input: channelId,
    });
    if (error) throw error;
    if (state.selectedCommunityChannel === channelId)
      state.selectedCommunityChannel = null;
    toast(`#${channelName} deleted.`, "success");
    await renderCommunityWorkspace(
      document.querySelector("#page"),
      communityId,
    );
  } catch (err) {
    toast(err.message || "Could not delete channel.", "error");
    if (button) button.disabled = false;
  }
};

async function renderNotifications(page) {
  await loadNotifications();
  const visibleCount = state.notificationVisibleCount || 10;
  const visible = state.notifications.slice(0, visibleCount);
  page.innerHTML = `<div class="pageHead"><div><div class="eyebrow">NOTIFICATIONS</div><h1>Activity</h1><p>Recent activity first. Older notifications are available with More.</p></div><button class="secondary" id="readAll">Mark all read</button></div><div class="notificationList">${visible.length ? visible.map((n) => `<button class="notification ${n.is_read ? "" : "unread"}" onclick="markNotification('${n.id}')">${image(n.actor?.avatar_url, n.actor?.display_name || n.actor?.username)}<span><p>${esc(n.message)}</p><small>${timeAgo(n.created_at)}</small></span></button>`).join("") : empty("You're all caught up", "New activity will appear here.")}</div>${state.notifications.length > visibleCount ? `<div class="notificationMoreWrap"><button class="secondary" id="moreNotifications">More notifications</button></div>` : ""}`;
  document.querySelector("#readAll").onclick = async () => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("recipient_id", state.session.user.id);
    await loadNotifications();
    renderShell();
    navigate("notifications");
  };
  const more = document.querySelector("#moreNotifications");
  if (more)
    more.onclick = () => {
      state.notificationVisibleCount = Math.min(
        state.notifications.length,
        visibleCount + 10,
      );
      renderNotifications(page);
    };
}
async function loadNotifications() {
  const { data } = await supabase
    .from("notifications")
    .select(
      "*,actor:profiles!notifications_actor_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .eq("recipient_id", state.session.user.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  state.notifications = data || [];
}
const unreadNotificationCount = () =>
  state.notifications.filter((x) => !x.is_read).length;
async function markNotification(id) {
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("recipient_id", state.session.user.id);
  await loadNotifications();
  renderShell();
  navigate("notifications");
}
window.markNotification = markNotification;

async function renderSettings(page) {
  page.innerHTML = `<div class="pageHead"><div><div class="eyebrow">SETTINGS</div><h1>Account settings</h1><p>Manage your account and personalization.</p></div></div><div class="settingsGrid"><div class="card settingsCard"><h2>Account</h2><label>Email<input disabled value="${esc(state.session.user.email || "")}"></label><button class="secondary" id="resetPassword">Send password reset email</button></div><div class="card settingsCard"><h2>Smart feed</h2><p class="muted">Live Coders automatically learns from searches, communities, posts, likes and conversations to rank relevant developer content. There is no interest questionnaire.</p><div class="autoSignal"><span>●</span> Personalization is automatic</div></div><div class="card settingsCard"><h2>Session</h2><button class="danger" id="settingsLogout">Log out</button></div></div>`;
  document.querySelector("#resetPassword").onclick = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      state.session.user.email,
      { redirectTo: location.origin },
    );
    toast(error?.message || "Reset email sent.", error ? "error" : "success");
  };
  document.querySelector("#settingsLogout").onclick = () =>
    supabase.auth.signOut();
}
function modal(content) {
  closeModal();
  const el = document.createElement("div");
  el.id = "modalRoot";
  el.className = "modalBackdrop";
  el.innerHTML = `<div class="modal"><button class="modalClose" onclick="closeModal()">×</button>${content}</div>`;
  document.body.appendChild(el);
}
function closeModal() {
  document.querySelector("#modalRoot")?.remove();
}
window.closeModal = closeModal;

async function searchPeopleForMention(q = "") {
  const term = String(q || "").trim();
  if (!term) return [];
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,display_name,full_name,avatar_url")
    .or(
      `username.ilike.${like},display_name.ilike.${like},full_name.ilike.${like}`,
    )
    .neq("id", state.session.user.id)
    .limit(8);
  if (error) throw error;
  return data || [];
}

function openPostModal(initialMode = "post") {
  // v20.6.1: creator supports Posts and Reels only. Existing Blogs remain viewable.
  const mode = initialMode === "reel" ? "reel" : "post";
  location.hash = `create?mode=${encodeURIComponent(mode)}`;
}
window.openPostModal = openPostModal;

function validate16x9Image(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Choose a valid cover image."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const exact16x9 =
        img.naturalWidth > 0 &&
        img.naturalHeight > 0 &&
        img.naturalWidth * 9 === img.naturalHeight * 16;
      URL.revokeObjectURL(url);
      if (!exact16x9) {
        reject(
          new Error(
            `Cover image must be exactly 16:9. Selected image is ${img.naturalWidth}×${img.naturalHeight}.`,
          ),
        );
        return;
      }
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the cover image."));
    };
    img.src = url;
  });
}

async function uploadPostImages(files) {
  const images = [];
  for (const file of [...(files || [])]) {
    if (!file.type.startsWith("image/")) continue;
    await validate16x9Image(file);
    if (file.size > 8 * 1024 * 1024)
      throw new Error("Each cover image must be smaller than 8 MB.");
    const path = `${state.session.user.id}/posts/${crypto.randomUUID()}-${(file.name || "image").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const up = await supabase.storage
      .from("post-media")
      .upload(path, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: "3600",
      });
    if (up.error) throw up.error;
    images.push(
      supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl,
    );
  }
  return images;
}

async function uploadReelCover(file) {
  if (!file?.size) return null;
  if (!file.type?.startsWith("image/"))
    throw new Error("Reel cover must be an image file.");
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Reel cover must be smaller than 8 MB.");
  await validate16x9Image(file);
  const safe = (file.name || "reel-cover").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${state.session.user.id}/reels/covers/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from("post-media")
    .upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "31536000",
    });
  if (error)
    throw new Error(
      `Reel cover upload failed: ${error.message || "storage error"}`,
    );
  return supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl;
}

async function uploadPostAttachments(files) {
  const attachments = [];
  for (const file of [...(files || [])].slice(0, 5)) {
    if (!file?.size) continue;
    if (file.type?.startsWith("image/"))
      throw new Error(
        "Posts support one cover image only. Add other files as non-image attachments.",
      );
    if (file.size > 20 * 1024 * 1024)
      throw new Error("Each attachment must be smaller than 20 MB.");
    const safeName = (file.name || "attachment").replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    );
    const path = `${state.session.user.id}/posts/attachments/${crypto.randomUUID()}-${safeName}`;
    const up = await supabase.storage
      .from("post-media")
      .upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      });
    if (up.error) throw up.error;
    attachments.push({
      name: file.name || safeName,
      type: file.type || "application/octet-stream",
      size: file.size,
      url: supabase.storage.from("post-media").getPublicUrl(path).data
        .publicUrl,
    });
  }
  return attachments;
}

async function uploadPostVideo(file) {
  if (!file?.size) throw new Error("Choose a video for your reel.");
  if (file.size > 60 * 1024 * 1024)
    throw new Error("Reels must be smaller than 60 MB.");
  const path = `${state.session.user.id}/reels/${crypto.randomUUID()}-${(file.name || "reel").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const up = await supabase.storage
    .from("post-media")
    .upload(path, file, {
      upsert: false,
      contentType: file.type || "video/mp4",
      cacheControl: "3600",
    });
  if (up.error) throw up.error;
  return {
    url: supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl,
    type: file.type || "video/mp4",
  };
}

function creatorMentionMarkup() {
  return `<div class="creatorMentions"><label>Tag people <input class="creatorMentionSearch" placeholder="Search a name or @username"></label><div class="creatorMentionResults"></div><div class="creatorSelectedMentions"></div></div>`;
}

function wireCreatorMentions(form) {
  const input = form?.querySelector(".creatorMentionSearch");
  const results = form?.querySelector(".creatorMentionResults");
  const selected = form?.querySelector(".creatorSelectedMentions");
  if (!input || !results || !selected) return;
  const people = [];
  const render = () => {
    selected.innerHTML = people
      .map(
        (m) =>
          `<span class="mentionChip">@${esc(m.username)} <button type="button" data-id="${m.id}" aria-label="Remove mention">×</button></span>`,
      )
      .join("");
    form.dataset.mentions = people.map((m) => m.id).join(",");
    selected.querySelectorAll("button").forEach(
      (btn) =>
        (btn.onclick = () => {
          const i = people.findIndex((x) => x.id === btn.dataset.id);
          if (i >= 0) people.splice(i, 1);
          render();
        }),
    );
  };
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const term = input.value.replace(/^@/, "").trim();
      if (!term) {
        results.innerHTML = "";
        return;
      }
      try {
        const list = await searchPeopleForMention(term);
        results.innerHTML = list
          .map(
            (m) =>
              `<button type="button" class="creatorMentionResult">${image(m.avatar_url, m.display_name || m.username, "avatar small")}<span><b>${esc(m.display_name || m.full_name || m.username)}</b><small>@${esc(m.username)}</small></span></button>`,
          )
          .join("");
        results.querySelectorAll("button").forEach(
          (btn, i) =>
            (btn.onclick = () => {
              const m = list[i];
              if (!people.some((x) => x.id === m.id)) people.push(m);
              input.value = "";
              results.innerHTML = "";
              render();
            }),
        );
      } catch (e) {
        toast(e.message || "Could not search people.", "error");
      }
    }, 180);
  });
}

async function publishCreateForm(form, mode) {
  const button = form.querySelector(".creatorPublishBtn");
  if (!button) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Publishing…";
  try {
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    if (!title) throw new Error("Add a title before publishing.");
    let bodyPages = [];
    let mediaUrl = null;
    let mediaType = null;

    if (mode === "post") {
      const coverFile =
        form.querySelector(".postCoverInput")?.files?.[0] || null;
      const attachments = await uploadPostAttachments(
        form.querySelector(".postAttachmentInput")?.files || [],
      );
      let cover = null;
      if (coverFile) {
        await validate16x9Image(coverFile);
        cover = (await uploadPostImages([coverFile]))[0] || null;
      }
      const text = String(fd.get("content") || "").trim();
      if (!text && !cover && !attachments.length)
        throw new Error(
          "Write something, add a cover image, or attach a file.",
        );
      bodyPages = [
        {
          text,
          images: [],
          ...(cover ? { cover } : {}),
          ...(attachments.length ? { attachments } : {}),
        },
      ];
    } else {
      const coverFile =
        form.querySelector(".reelCoverInput")?.files?.[0] || null;
      let cover = null;
      if (coverFile) cover = await uploadReelCover(coverFile);
      const media = await uploadPostVideo(fd.get("media"));
      mediaUrl = media.url;
      mediaType = media.type;
      bodyPages = [
        {
          text: String(fd.get("caption") || "").trim(),
          images: [],
          ...(cover ? { cover } : {}),
        },
      ];
    }

    const payload = {
      author_id: state.session.user.id,
      title,
      content:
        mode === "reel"
          ? String(fd.get("caption") || "").trim()
          : bodyPages[0]?.text || "",
      tags: String(fd.get("tags") || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      category: String(fd.get("category") || "Project Showcase"),
      post_type: mode,
      body_pages: bodyPages,
      media_url: mediaUrl,
      media_type: mediaType,
      visibility: "public",
    };
    const { data: created, error } = await supabase
      .from("posts")
      .insert(payload)
      .select("id,title")
      .single();
    if (error) throw error;

    const mentionIds = String(form.dataset.mentions || "")
      .split(",")
      .filter(Boolean);
    if (mentionIds.length) {
      const { error: mentionError } = await supabase
        .from("post_mentions")
        .insert(
          mentionIds.map((id) => ({
            post_id: created.id,
            mentioned_user_id: id,
          })),
        );
      if (mentionError) throw mentionError;
      await supabase
        .from("notifications")
        .insert(
          mentionIds.map((id) => ({
            recipient_id: id,
            actor_id: state.session.user.id,
            notification_type: "mention",
            related_entity_id: created.id,
            related_entity_type: "post",
            message: `${state.profile?.display_name || state.profile?.username || "Someone"} mentioned you in a ${mode}.`,
          })),
        );
    }
    toast(mode === "reel" ? "Reel published." : "Post published.", "success");
    location.hash = "home";
  } catch (err) {
    console.error("publishCreateForm", err);
    toast(
      err.message || "We couldn't publish your content. Please try again.",
      "error",
    );
    button.disabled = false;
    button.textContent = original;
  }
}

async function renderCreate(page, activeMode = "post") {
  const mode = activeMode === "reel" ? "reel" : "post";
  const labels = { post: "Post", reel: "Reel" };
  page.innerHTML = `<div class="creatorStudio">
    <div class="creatorStudioHeader"><div><div class="eyebrow">CREATOR STUDIO</div><h1>Create a ${labels[mode]}</h1><p>${mode === "post" ? "Share an update, idea, project or tip with an optional cover image and file attachments." : "Share a short video showing what you are building."}</p></div></div>
    <div class="creatorModeTabs" role="tablist" aria-label="Choose content type">
      <button type="button" class="creatorModeTab ${mode === "post" ? "active" : ""}" onclick="openPostModal('post')">POST</button>
      <button type="button" class="creatorModeTab ${mode === "reel" ? "active" : ""}" onclick="openPostModal('reel')">REEL</button>
    </div>
    <div class="creatorSingleWorkspace">
      ${
        mode === "post"
          ? `<form class="creatorForm creatorSingleForm" id="postCreatorForm">
        <div class="creatorStep"><b>1</b><strong>Create Post</strong></div>
        <input name="title" required maxlength="180" placeholder="Title">
        <textarea class="creatorSingleText" name="content" rows="9" maxlength="5000" placeholder="What's on your mind? Share something with the community…"></textarea>
        <label class="creatorUploadBox"><span>＋ Add cover image</span><small>One optional cover image · exactly 16:9 · JPG, PNG or WEBP</small><input class="postCoverInput" type="file" accept="image/*"></label>
        <div class="postCoverPreview creatorImagePreview"></div>
        <label class="creatorUploadBox"><span>＋ Attach files</span><small>Up to 5 non-image files · 20 MB each</small><input class="postAttachmentInput" type="file" multiple accept=".pdf,.doc,.docx,.txt,.csv,.json,.zip,.rar,.js,.ts,.jsx,.tsx,.html,.css,.md"></label>
        <div class="postAttachmentPreview"></div>
        ${creatorMentionMarkup()}
        <label>Topics<input name="tags" placeholder="React, startup, AI, trading"></label>
        <label>Category<select name="category"><option>Project Showcase</option><option>Developer Problem</option><option>Startup Discussion</option><option>Trading</option><option>AI & Machine Learning</option><option>Web Development</option><option>Career & Jobs</option><option>Founders & Growth</option></select></label>
        <button class="primary creatorPublishBtn" type="submit">Publish Post</button>
      </form>`
          : `<form class="creatorForm creatorSingleForm" id="reelCreatorForm">
        <div class="creatorStep"><b>1</b><strong>Create Reel</strong></div>
        <label class="creatorVideoDrop"><span>＋</span><strong>Upload video</strong><small>MP4, MOV or WebM · max 60 MB</small><input name="media" type="file" accept="video/*" required></label>
        <div class="creatorVideoPreview"></div>
        <input name="title" required maxlength="180" placeholder="Reel title">
        <textarea name="caption" rows="6" maxlength="2200" placeholder="Tell people what the reel shows…"></textarea>
        <label class="creatorUploadBox reelCoverUpload"><span>＋ Add reel cover</span><small>Optional thumbnail · exactly 16:9 · JPG, PNG or WEBP · max 8 MB</small><input class="reelCoverInput" type="file" accept="image/jpeg,image/png,image/webp"></label><div class="reelCoverPreview"></div>
        ${creatorMentionMarkup()}
        <label>Topics<input name="tags" placeholder="AI, trading, startup, build in public"></label>
        <label>Category<select name="category"><option>Project Showcase</option><option>AI & Machine Learning</option><option>Trading</option><option>Startup Discussion</option><option>Web Development</option><option>Career & Jobs</option><option>Founders & Growth</option></select></label>
        <button class="creatorPublishBtn reelPublish" type="submit">Publish Reel</button>
      </form>`
      }
    </div>
    <footer class="creatorFooter">© ${new Date().getFullYear()} Live Coders. All rights reserved.</footer>
  </div>`;

  const form = document.querySelector("#postCreatorForm, #reelCreatorForm");
  wireCreatorMentions(form);
  form.onsubmit = (e) => {
    e.preventDefault();
    publishCreateForm(e.currentTarget, mode);
  };
  document
    .querySelector(".postCoverInput")
    ?.addEventListener("change", async (e) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      const preview = document.querySelector(".postCoverPreview");
      if (!file) {
        preview.innerHTML = "";
        return;
      }
      try {
        await validate16x9Image(file);
        preview.innerHTML = `<div class="creatorPreviewImage"><img src="${URL.createObjectURL(file)}" alt="Post cover"><span>16:9 cover · ${esc(file.name)}</span></div>`;
      } catch (err) {
        input.value = "";
        preview.innerHTML = `<div class="coverRatioError">${esc(err.message)}</div>`;
        toast(err.message, "error");
      }
    });
  document
    .querySelector(".postAttachmentInput")
    ?.addEventListener("change", (e) => {
      const files = [...(e.target.files || [])].slice(0, 5);
      document.querySelector(".postAttachmentPreview").innerHTML = files
        .map(
          (file) =>
            `<div class="creatorAttachmentChip">📎 ${esc(file.name)} <small>${Math.ceil(file.size / 1024)} KB</small></div>`,
        )
        .join("");
    });
  document
    .querySelector(".reelCoverInput")
    ?.addEventListener("change", async (e) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      const preview = document.querySelector(".reelCoverPreview");
      if (!file) {
        preview.innerHTML = "";
        return;
      }
      try {
        await validate16x9Image(file);
        if (file.size > 8 * 1024 * 1024)
          throw new Error("Reel cover must be smaller than 8 MB.");
        const url = URL.createObjectURL(file);
        preview.innerHTML = `<img src="${url}" alt="Reel cover"><div class="coverSelectionMeta"><small class="coverRatioOk">16:9 cover accepted</small><small>${esc(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB</small></div>`;
      } catch (err) {
        input.value = "";
        preview.innerHTML = `<div class="coverRatioError">${esc(err.message)}</div>`;
        toast(err.message, "error");
      }
    });
  document
    .querySelector("#reelCreatorForm input[name='media']")
    ?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file)
        document.querySelector(".creatorVideoPreview").innerHTML =
          `<video controls preload="metadata" src="${URL.createObjectURL(file)}"></video><span>${esc(file.name)}</span>`;
    });
}
window.renderCreate = renderCreate;

async function uploadImage(file, bucket, path) {
  if (!file) return null;
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!allowed.includes(file.type))
    throw new Error("Please choose a PNG, JPG, WEBP or GIF image.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Image must be smaller than 5 MB.");
  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const final = `${path}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(final, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "3600",
  });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(final).data.publicUrl;
}

function openProfileModal() {
  const p = state.profile || {};
  modal(
    `<h2>Edit profile</h2><form id="profileForm"><label>Profile picture<input name="avatar" type="file" accept="image/*"></label><label>Display name<input name="displayName" value="${esc(p.display_name || p.full_name || "")}"></label><label>Bio<textarea name="bio" rows="4">${esc(p.bio || "")}</textarea></label><label>Location<input name="location" value="${esc(p.location || "")}"></label><label>Skills<input name="skills" value="${esc((p.skills || []).join(", "))}"></label><label>Experience<textarea name="experience" rows="4">${esc(p.experience || "")}</textarea></label><label>GitHub URL<input name="githubUrl" value="${esc(p.github_url || "")}"></label><label>LinkedIn URL<input name="linkedinUrl" value="${esc(p.linkedin_url || "")}"></label><label>Portfolio URL<input name="portfolioUrl" value="${esc(p.portfolio_url || "")}"></label><label>Website<input name="websiteUrl" value="${esc(p.website_url || "")}"></label><div class="sectionTitle"><h3>Projects</h3><button type="button" class="secondary" onclick="closeModal();openProjectModal()">+ Add project</button></div><button class="primary full">Save changes</button></form>`,
  );
  document.querySelector("#profileForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      let avatar = p.avatar_url;
      if (f.get("avatar")?.size)
        avatar = await uploadImage(
          f.get("avatar"),
          "avatars",
          `${state.session.user.id}/avatar`,
        );
      const patch = {
        avatar_url: avatar,
        display_name: f.get("displayName"),
        bio: f.get("bio"),
        location: f.get("location"),
        skills: String(f.get("skills"))
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        experience: f.get("experience"),
        github_url: f.get("githubUrl"),
        linkedin_url: f.get("linkedinUrl"),
        portfolio_url: f.get("portfolioUrl"),
        website_url: f.get("websiteUrl"),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", state.session.user.id);
      if (error) throw error;
      await profile();
      closeModal();
      renderShell();
      navigate("profile");
      toast("Profile updated.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };
}
window.openProfileModal = openProfileModal;

function openProjectModal() {
  modal(
    `<h2>Add project</h2><form id="projectForm"><label>Project name<input name="name" required></label><label>Description<textarea name="description" rows="4"></textarea></label><label>Project URL<input name="url"></label><label>Repository URL<input name="repo"></label><label>Technologies<input name="tech" placeholder="Next.js, Supabase"></label><label>Community <select name="community"><option value="">No community</option></select></label><button class="primary full">Save project</button></form>`,
  );
  loadUserCommunityOptions();
  document.querySelector("#projectForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase.from("projects").insert({
      owner_id: state.session.user.id,
      name: f.get("name"),
      description: f.get("description"),
      url: f.get("url"),
      repository_url: f.get("repo"),
      technologies: String(f.get("tech"))
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      community_id: f.get("community") || null,
    });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Project added.", "success");
      navigate("profile");
    }
  };
}
window.openProjectModal = openProjectModal;
async function loadUserCommunityOptions() {
  const select = document.querySelector('[name="community"]');
  if (!select) return;
  try {
    const [
      { data: members, error: memberError },
      { data: created, error: createdError },
    ] = await Promise.all([
      supabase
        .from("community_members")
        .select("community_id")
        .eq("user_id", state.session.user.id),
      supabase
        .from("communities")
        .select("id,name")
        .eq("creator_id", state.session.user.id),
    ]);
    if (memberError || createdError) throw memberError || createdError;
    const ids = [
      ...new Set(
        [
          ...(members || []).map((x) => x.community_id),
          ...(created || []).map((x) => x.id),
        ].filter(Boolean),
      ),
    ];
    if (!ids.length) {
      select.innerHTML = '<option value="">No joined communities</option>';
      return;
    }
    const { data: communities, error: communityError } = await supabase
      .from("communities")
      .select("id,name")
      .in("id", ids)
      .order("name");
    if (communityError) throw communityError;
    select.innerHTML =
      '<option value="">No community</option>' +
      (communities || [])
        .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
        .join("");
  } catch (err) {
    select.innerHTML = '<option value="">No joined communities</option>';
    console.error(err);
  }
}

async function openCommunityModal(id = null) {
  let c = null;
  if (id) {
    const r = await supabase
      .from("communities")
      .select("*")
      .eq("id", id)
      .single();
    if (r.error) return toast(r.error.message, "error");
    c = r.data;
    if (!c || c.creator_id !== state.session.user.id)
      return toast("Only the community creator can edit it.", "error");
  }
  modal(`<h2>${c ? "Edit" : "Create"} community</h2><form id="communityForm" class="communityForm">
    <div class="logoPicker"><div id="communityLogoPreview">${image(c?.logo_url, c?.name || "Community", "communityLogoPreviewImg")}</div><div><label>Community logo<input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><small>PNG, JPG, WEBP or GIF · max 5 MB</small></div></div>
    <label>Name<input name="name" required maxlength="80" value="${esc(c?.name || "")}"></label>
    <label>Description<textarea name="description" required rows="4" maxlength="500">${esc(c?.description || "")}</textarea></label>
    <div class="modalTwoCol"><label>Community type<select name="category"><option value="Startups & Founders" >Startups & Founders</option><option value="AI & Machine Learning" >AI & Machine Learning</option><option value="Web Development" selected>Web Development</option><option value="Mobile Development" >Mobile Development</option><option value="Data Science" >Data Science</option><option value="Cybersecurity" >Cybersecurity</option><option value="Cloud & DevOps" >Cloud & DevOps</option><option value="Game Development" >Game Development</option><option value="Blockchain & Web3" >Blockchain & Web3</option><option value="Open Source" >Open Source</option><option value="UI/UX & Design" >UI/UX & Design</option><option value="Programming Languages" >Programming Languages</option><option value="Career & Jobs" >Career & Jobs</option><option value="Freelancing" >Freelancing</option><option value="Robotics & IoT" >Robotics & IoT</option><option value="No-Code & Automation" >No-Code & Automation</option></select></label><label>Required skills<input name="skills" value="${esc((c?.required_skills || []).join(", "))}" placeholder="React, Python, founders"></label></div>
    <label>Rules<textarea name="rules" rows="4">${esc(c?.rules || "")}</textarea></label>
    <div class="modalTwoCol"><label>Location<input name="location" value="${esc(c?.location || "")}" placeholder="City, Country or Remote"></label><label>Remote mode<select name="remote"><option ${c?.remote_mode === "Remote" || !c ? "selected" : ""}>Remote</option><option ${c?.remote_mode === "Hybrid" ? "selected" : ""}>Hybrid</option><option ${c?.remote_mode === "Onsite" ? "selected" : ""}>Onsite</option></select></label></div>
    <label class="checkLabel"><input type="checkbox" name="recruitment" ${c?.recruitment_enabled ? "checked" : ""}><span>Enable recruitment</span></label>
    <button class="primary full" id="communitySaveBtn">${c ? "Save changes" : "Create community"}</button>
  </form>`);
  const form = document.querySelector("#communityForm");
  const categorySelect = form.querySelector('[name="category"]');
  if (categorySelect && c?.category) categorySelect.value = c.category;
  const fileInput = form.querySelector('[name="logo"]');
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const img = document.createElement("img");
    img.className = "communityLogoPreviewImg";
    img.alt = "Community logo preview";
    img.src = URL.createObjectURL(f);
    document.querySelector("#communityLogoPreview").replaceChildren(img);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = document.querySelector("#communitySaveBtn");
    button.disabled = true;
    button.textContent = c ? "Saving…" : "Creating…";
    const f = new FormData(form);
    try {
      const base = {
        name: String(f.get("name")).trim(),
        description: String(f.get("description")).trim(),
        category: String(f.get("category") || "").trim(),
        skills_input: String(f.get("skills") || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        rules: String(f.get("rules") || "").trim(),
        remote: String(f.get("remote") || "Remote"),
        recruitment: f.has("recruitment"),
        location: String(f.get("location") || "").trim(),
      };
      if (!base.name || !base.description)
        throw new Error("Name and description are required.");
      let communityId = id;
      if (!c) {
        const r = await supabase.rpc("create_community", {
          name_input: base.name,
          description_input: base.description,
          category_input: base.category,
          skills_input: base.skills_input,
          rules_input: base.rules,
          remote_mode_input: base.remote,
          recruitment_input: base.recruitment,
          location_input: base.location,
          logo_url_input: null,
        });
        if (r.error) throw r.error;
        communityId = r.data;
      }
      let logoUrl = c?.logo_url || null;
      if (fileInput.files?.[0]) {
        const safePath = `${state.session.user.id}/${communityId}/${crypto.randomUUID()}`;
        logoUrl = await uploadImage(
          fileInput.files[0],
          "community-avatars",
          safePath,
        );
      }
      const r = await supabase.rpc("update_community", {
        community_id_input: communityId,
        name_input: base.name,
        description_input: base.description,
        category_input: base.category,
        skills_input: base.skills_input,
        rules_input: base.rules,
        remote_mode_input: base.remote,
        recruitment_input: base.recruitment,
        location_input: base.location,
        logo_url_input: logoUrl,
      });
      if (r.error) throw r.error;
      closeModal();
      toast(c ? "Community updated." : "Community created.", "success");
      navigate(`community?id=${communityId}`);
    } catch (err) {
      toast(err.message || "Could not save community.", "error");
      button.disabled = false;
      button.textContent = c ? "Save changes" : "Create community";
    }
  };
}
window.openCommunityModal = openCommunityModal;

window.openCommunityEventModal = async function (communityId) {
  modal(
    `<h2>Add community event</h2><form id="eventForm"><label>Event title<input name="title" required maxlength="120"></label><label>Description<textarea name="description" rows="3"></textarea></label><label>Starts at<input name="starts" type="datetime-local" required></label><label>Ends at<input name="ends" type="datetime-local"></label><label>Meeting URL<input name="url" placeholder="https://…"></label><button class="primary full">Create event</button></form>`,
  );
  document.querySelector("#eventForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase.from("community_events").insert({
      community_id: communityId,
      creator_id: state.session.user.id,
      title: String(f.get("title")),
      description: String(f.get("description") || ""),
      starts_at: new Date(f.get("starts")).toISOString(),
      ends_at: f.get("ends") ? new Date(f.get("ends")).toISOString() : null,
      meeting_url: String(f.get("url") || ""),
    });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Event created.", "success");
      renderCommunityWorkspace(document.querySelector("#page"), communityId);
    }
  };
};
window.openCommunityFileModal = async function (communityId) {
  modal(
    `<h2>Add shared resource</h2><form id="fileForm"><label>Name<input name="name" required maxlength="160"></label><label>URL<input name="url" type="url" required placeholder="https://…"></label><label>Type<input name="type" placeholder="PDF, Design, Docs…"></label><button class="primary full">Add resource</button></form>`,
  );
  document.querySelector("#fileForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase.from("community_files").insert({
      community_id: communityId,
      uploader_id: state.session.user.id,
      name: String(f.get("name")),
      url: String(f.get("url")),
      file_type: String(f.get("type") || ""),
    });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Resource added.", "success");
      renderCommunityWorkspace(document.querySelector("#page"), communityId);
    }
  };
};

function subscribeRealtime() {
  if (state.realtime) state.realtime.unsubscribe();
  state.realtime = supabase
    .channel("live-coders-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      async (p) => {
        if (
          state.route === "messages" &&
          p.new?.conversation_id === state.selectedConversation
        )
          refreshDirectMessages(state.selectedConversation, true);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${state.session.user.id}`,
      },
      async () => {
        await loadNotifications();
        const b = document.querySelector("#notifBadge");
        if (b) {
          b.textContent = unreadNotificationCount();
          b.classList.toggle("hidden", !unreadNotificationCount());
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "community_messages" },
      async (p) => {
        if (state.route === "community") {
          const id = new URLSearchParams(location.hash.split("?")[1] || "").get(
            "id",
          );
          if (id === p.new?.community_id) refreshCommunityChat(id);
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "posts" },
      async (p) => {
        if (
          state.route !== "home" ||
          !state.session?.user?.id ||
          !p.new?.author_id
        )
          return;
        const { data: follow } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", state.session.user.id)
          .eq("following_id", p.new.author_id)
          .maybeSingle();
        if (!follow) return;
        state.feedPriorityIds = [
          ...new Set([...(state.feedPriorityIds || []), p.new.id]),
        ];
        // Do not reload the whole feed. The new followed post will appear on the next refresh.
        const feed = document.querySelector("#feedList");
        if (
          feed &&
          !feed.querySelector(`[data-post-id="${CSS.escape(p.new.id)}"]`)
        ) {
          const notice = document.createElement("div");
          notice.className = "newContentNotice";
          notice.textContent =
            "New post from someone you follow — refresh to view";
          feed.prepend(notice);
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "post_comments" },
      async (p) => {
        // Comments are updated locally; never reload the home page for a comment event.
        const postId = p.new?.post_id;
        if (
          !postId ||
          !document.querySelector(
            `[data-comment-button="${CSS.escape(postId)}"]`,
          )
        )
          return;
      },
    )
    .subscribe();
}

bootstrap();
