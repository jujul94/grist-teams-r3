const TABLES = {
  users: "Utilisateurs",
  channels: "Canaux",
  posts: "Publications",
  comments: "Commentaires"
};

let channels = [];
let posts = [];
let comments = [];
let users = [];

let currentChannel = null;
let currentUserId = null;

let editState = null;

grist.ready({
  requiredAccess: "full"
});

/* =========================
   OUTILS
========================= */

function rowsFromTable(table) {
  if (!table || !table.id) return [];

  return table.id.map((id, index) => {
    const row = { id };

    Object.keys(table).forEach(column => {
      if (column !== "id") {
        row[column] = table[column][index];
      }
    });

    return row;
  });
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getUser(id) {
  return users.find(user => user.id === id);
}

function getUserName(id) {
  const user = getUser(id);

  if (!user) return "Utilisateur";

  return (
    user.Nom_affiche ||
    [user.Prenom, user.Nom].filter(Boolean).join(" ") ||
    "Utilisateur"
  );
}

function getInitials(id) {
  const user = getUser(id);

  if (!user) return "?";

  if (user.Initiales) return user.Initiales;

  return getUserName(id)
    .split(" ")
    .map(part => part[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function isMine(authorId) {
  return Number(authorId) === Number(currentUserId);
}

/* =========================
   UTILISATEUR ACTIF
========================= */

function renderCurrentUserSelector() {

  const select =
    document.getElementById("current-user-select");

  select.innerHTML = "";

  const activeUsers =
    users.filter(user => user.Actif !== false);

  activeUsers.forEach(user => {

    const option =
      document.createElement("option");

    option.value = user.id;
    option.textContent = getUserName(user.id);

    select.appendChild(option);
  });

  if (!currentUserId && activeUsers.length) {
    currentUserId = activeUsers[0].id;
  }

  select.value = currentUserId || "";

  select.onchange = () => {
    currentUserId = Number(select.value);
    renderFeed();
  };
}

/* =========================
   CANAUX
========================= */

function renderChannels() {

  const container =
    document.getElementById("channels");

  container.innerHTML = "";

  [...channels]
    .sort((a, b) => (a.Ordre || 0) - (b.Ordre || 0))
    .forEach(channel => {

      const button =
        document.createElement("button");

      button.className =
        "channel" +
        (
          currentChannel &&
          currentChannel.id === channel.id
            ? " active"
            : ""
        );

      const isPrivate =
        String(channel.Type_acces || "")
          .toLowerCase()
          .includes("encadrement");

      button.textContent =
        (isPrivate ? "🔒 " : "# ") +
        (channel.Nom || "Canal");

      button.addEventListener("click", () => {
        currentChannel = channel;
        closeComposer();
        renderChannels();
        renderFeed();
      });

      container.appendChild(button);
    });
}

/* =========================
   FIL
========================= */

function renderFeed() {

  const feed =
    document.getElementById("feed");

  const title =
    document.getElementById("channel-title");

  const description =
    document.getElementById("channel-description");

  if (!currentChannel) {
    feed.innerHTML =
      '<div class="message">Aucun canal disponible.</div>';
    return;
  }

  title.textContent =
    "# " + currentChannel.Nom;

  description.textContent =
    currentChannel.Description || "";

  let channelPosts =
    posts.filter(post =>
      post.Canal === currentChannel.id &&
      !post.Archive
    );

  channelPosts.sort((a, b) => {

    if (!!a.Epingle !== !!b.Epingle) {
      return a.Epingle ? -1 : 1;
    }

    return (
      new Date(b.Date_creation || 0) -
      new Date(a.Date_creation || 0)
    );
  });

  if (!channelPosts.length) {
    feed.innerHTML =
      '<div class="message">Aucune publication dans ce canal.</div>';
    return;
  }

  feed.innerHTML = "";

  channelPosts.forEach(post => {

    const article =
      document.createElement("article");

    article.className = "post";

    article.dataset.postId = post.id;

    const postComments =
      comments
        .filter(comment =>
          comment.Publication === post.id &&
          !comment.Supprime
        )
        .sort((a, b) =>
          new Date(a.Date_creation || 0) -
          new Date(b.Date_creation || 0)
        );

    const commentsHtml =
      postComments.map(comment => {

        const actions =
          isMine(comment.Auteur)
            ? `
              <div class="comment-actions">

                <button
                  class="text-button edit-comment"
                  data-comment-id="${comment.id}"
                >
                  Modifier
                </button>

                <button
                  class="text-button danger-button delete-comment"
                  data-comment-id="${comment.id}"
                >
                  Supprimer
                </button>

              </div>
            `
            : "";

        return `
          <div class="comment">

            <div class="comment-header">

              <span class="comment-author">
                ${escapeHtml(
                  getUserName(comment.Auteur)
                )}
              </span>

              <span class="comment-date">
                ${escapeHtml(
                  formatDate(comment.Date_creation)
                )}
              </span>

              ${comment.Modifie
                ? '<span class="edited">modifié</span>'
                : ""
              }

            </div>

            <div class="comment-content">${escapeHtml(
              comment.Contenu
            )}</div>

            ${actions}

          </div>
        `;
      }).join("");

    const postActions =
      isMine(post.Auteur)
        ? `
          <div class="post-actions">

            <button
              class="text-button edit-post"
              data-post-id="${post.id}"
            >
              Modifier
            </button>

            <button
              class="text-button toggle-pin"
              data-post-id="${post.id}"
            >
              ${post.Epingle
                ? "Désépingler"
                : "Épingler"
              }
            </button>

            <button
              class="text-button danger-button delete-post"
              data-post-id="${post.id}"
            >
              Supprimer
            </button>

          </div>
        `
        : "";

    article.innerHTML = `

      ${post.Epingle
        ? '<div class="pin">📌 Publication épinglée</div>'
        : ""
      }

      <div class="post-meta">

        <div class="avatar">
          ${escapeHtml(
            getInitials(post.Auteur)
          )}
        </div>

        <div>

          <div class="author">
            ${escapeHtml(
              getUserName(post.Auteur)
            )}
          </div>

          <div class="date">
            ${escapeHtml(
              formatDate(post.Date_creation)
            )}

            ${post.Modifie
              ? " · modifié"
              : ""
            }
          </div>

        </div>

      </div>

      <div class="post-title">
        ${escapeHtml(post.Titre)}
      </div>

      <div class="post-content">${escapeHtml(
        post.Contenu
      )}</div>

      ${post.Lien
        ? `
          <a
            class="post-link"
            href="${escapeHtml(post.Lien)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            🔗 Ouvrir le lien
          </a>
        `
        : ""
      }

      ${postActions}

      <div class="comments">

        ${postComments.length
          ? `
            <div class="comments-title">
              ${postComments.length}
              ${postComments.length > 1
                ? "réponses"
                : "réponse"
              }
            </div>
          `
          : ""
        }

        ${commentsHtml}

        <div class="reply-box">

          <textarea
            class="reply-content"
            placeholder="Répondre en tant que ${escapeHtml(
              getUserName(currentUserId)
            )}…"
          ></textarea>

          <button class="primary reply-button">
            Répondre
          </button>

        </div>

      </div>
    `;

    attachPostEvents(article, post);

    feed.appendChild(article);
  });
}

/* =========================
   EVENEMENTS D'UN THREAD
========================= */

function attachPostEvents(article, post) {

  article
    .querySelector(".reply-button")
    .addEventListener("click", async () => {

      const textarea =
        article.querySelector(".reply-content");

      const content =
        textarea.value.trim();

      if (!content) return;

      await createComment(
        post.id,
        currentUserId,
        content
      );
    });

  const editPost =
    article.querySelector(".edit-post");

  if (editPost) {
    editPost.addEventListener(
      "click",
      () => openPostEditor(post.id)
    );
  }

  const deletePostButton =
    article.querySelector(".delete-post");

  if (deletePostButton) {
    deletePostButton.addEventListener(
      "click",
      () => deletePost(post.id)
    );
  }

  const pinButton =
    article.querySelector(".toggle-pin");

  if (pinButton) {
    pinButton.addEventListener(
      "click",
      () => togglePin(post.id)
    );
  }

  article
    .querySelectorAll(".edit-comment")
    .forEach(button => {

      button.addEventListener(
        "click",
        () =>
          openCommentEditor(
            Number(button.dataset.commentId)
          )
      );
    });

  article
    .querySelectorAll(".delete-comment")
    .forEach(button => {

      button.addEventListener(
        "click",
        () =>
          deleteComment(
            Number(button.dataset.commentId)
          )
      );
    });
}

/* =========================
   NOUVELLE PUBLICATION
========================= */

function openComposer() {
  document
    .getElementById("composer")
    .classList.remove("hidden");

  document
    .getElementById("post-title")
    .focus();
}

function closeComposer() {

  document
    .getElementById("composer")
    .classList.add("hidden");

  document.getElementById("post-title").value = "";
  document.getElementById("post-content").value = "";
  document.getElementById("post-link").value = "";
  document.getElementById("post-pin").checked = false;
  document.getElementById("composer-message").innerHTML = "";
}

async function createPost() {

  if (!currentChannel || !currentUserId) return;

  const title =
    document.getElementById("post-title").value.trim();

  const content =
    document.getElementById("post-content").value.trim();

  const link =
    document.getElementById("post-link").value.trim();

  const pin =
    document.getElementById("post-pin").checked;

  if (!title || !content) {
    document.getElementById("composer-message").innerHTML =
      '<div class="error">Le titre et le message sont obligatoires.</div>';
    return;
  }

  await grist.docApi.applyUserActions([
    [
      "AddRecord",
      TABLES.posts,
      null,
      {
        Canal: currentChannel.id,
        Auteur: currentUserId,
        Date_creation: Date.now() / 1000,
        Titre: title,
        Contenu: content,
        Epingle: pin,
        Lien: link,
        Archive: false
      }
    ]
  ]);

  closeComposer();
  await loadData();
}

/* =========================
   COMMENTAIRES
========================= */

async function createComment(
  postId,
  authorId,
  content
) {

  await grist.docApi.applyUserActions([
    [
      "AddRecord",
      TABLES.comments,
      null,
      {
        Publication: postId,
        Auteur: authorId,
        Date_creation: Date.now() / 1000,
        Contenu: content,
        Supprime: false
      }
    ]
  ]);

  await loadData();
}

/* =========================
   EDITION
========================= */

function openPostEditor(postId) {

  const post =
    posts.find(p => p.id === postId);

  if (!post || !isMine(post.Auteur)) return;

  editState = {
    type: "post",
    id: postId
  };

  document.getElementById("edit-modal-title").textContent =
    "Modifier la publication";

  document.getElementById("edit-title-field")
    .classList.remove("hidden");

  document.getElementById("edit-link-field")
    .classList.remove("hidden");

  document.getElementById("edit-pin-field")
    .classList.remove("hidden");

  document.getElementById("edit-title").value =
    post.Titre || "";

  document.getElementById("edit-content").value =
    post.Contenu || "";

  document.getElementById("edit-link").value =
    post.Lien || "";

  document.getElementById("edit-pin").checked =
    !!post.Epingle;

  document.getElementById("edit-modal")
    .classList.remove("hidden");
}

function openCommentEditor(commentId) {

  const comment =
    comments.find(c => c.id === commentId);

  if (!comment || !isMine(comment.Auteur)) return;

  editState = {
    type: "comment",
    id: commentId
  };

  document.getElementById("edit-modal-title").textContent =
    "Modifier la réponse";

  document.getElementById("edit-title-field")
    .classList.add("hidden");

  document.getElementById("edit-link-field")
    .classList.add("hidden");

  document.getElementById("edit-pin-field")
    .classList.add("hidden");

  document.getElementById("edit-content").value =
    comment.Contenu || "";

  document.getElementById("edit-modal")
    .classList.remove("hidden");
}

function closeEditModal() {

  editState = null;

  document.getElementById("edit-modal")
    .classList.add("hidden");
}

async function saveEdit() {

  if (!editState) return;

  if (editState.type === "post") {

    const post =
      posts.find(p => p.id === editState.id);

    if (!post || !isMine(post.Auteur)) return;

    await grist.docApi.applyUserActions([
      [
        "UpdateRecord",
        TABLES.posts,
        post.id,
        {
          Titre:
            document.getElementById("edit-title").value.trim(),

          Contenu:
            document.getElementById("edit-content").value.trim(),

          Lien:
            document.getElementById("edit-link").value.trim(),

          Epingle:
            document.getElementById("edit-pin").checked,

          Modifie: true,

          Date_modification:
            Date.now() / 1000
        }
      ]
    ]);

  } else {

    const comment =
      comments.find(c => c.id === editState.id);

    if (!comment || !isMine(comment.Auteur)) return;

    await grist.docApi.applyUserActions([
      [
        "UpdateRecord",
        TABLES.comments,
        comment.id,
        {
          Contenu:
            document.getElementById("edit-content").value.trim(),

          Modifie: true,

          Date_modification:
            Date.now() / 1000
        }
      ]
    ]);
  }

  closeEditModal();
  await loadData();
}

/* =========================
   SUPPRESSION / EPINGLAGE
========================= */

async function deletePost(postId) {

  const post =
    posts.find(p => p.id === postId);

  if (!post || !isMine(post.Auteur)) return;

  if (!confirm(
    "Supprimer cette publication ?"
  )) return;

  /*
   * Suppression logique :
   * on archive plutôt que de détruire la ligne.
   */

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      TABLES.posts,
      post.id,
      {
        Archive: true
      }
    ]
  ]);

  await loadData();
}

async function deleteComment(commentId) {

  const comment =
    comments.find(c => c.id === commentId);

  if (!comment || !isMine(comment.Auteur)) return;

  if (!confirm(
    "Supprimer cette réponse ?"
  )) return;

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      TABLES.comments,
      comment.id,
      {
        Supprime: true
      }
    ]
  ]);

  await loadData();
}

async function togglePin(postId) {

  const post =
    posts.find(p => p.id === postId);

  if (!post || !isMine(post.Auteur)) return;

  await grist.docApi.applyUserActions([
    [
      "UpdateRecord",
      TABLES.posts,
      post.id,
      {
        Epingle: !post.Epingle
      }
    ]
  ]);

  await loadData();
}

/* =========================
   CHARGEMENT
========================= */

async function loadData() {

  try {

    const previousChannelId =
      currentChannel
        ? currentChannel.id
        : null;

    const [
      channelsRaw,
      postsRaw,
      commentsRaw,
      usersRaw
    ] = await Promise.all([

      grist.docApi.fetchTable(TABLES.channels),
      grist.docApi.fetchTable(TABLES.posts),
      grist.docApi.fetchTable(TABLES.comments),
      grist.docApi.fetchTable(TABLES.users)

    ]);

    channels =
      rowsFromTable(channelsRaw);

    posts =
      rowsFromTable(postsRaw);

    comments =
      rowsFromTable(commentsRaw);

    users =
      rowsFromTable(usersRaw);

    if (
      !currentUserId ||
      !users.some(u => u.id === currentUserId)
    ) {
      const firstActive =
        users.find(u => u.Actif !== false);

      currentUserId =
        firstActive ? firstActive.id : null;
    }

    if (previousChannelId) {
      currentChannel =
        channels.find(
          channel =>
            channel.id === previousChannelId
        ) || null;
    }

    if (!currentChannel) {
      currentChannel =
        channels.find(
          channel =>
            String(channel.Nom)
              .toLowerCase() === "général"
        ) ||
        channels[0] ||
        null;
    }

    renderCurrentUserSelector();
    renderChannels();
    renderFeed();

  } catch (error) {

    console.error(error);

    document.getElementById("feed").innerHTML = `
      <div class="message error">
        <strong>Impossible de lire les données Grist.</strong>
        <br><br>
        ${escapeHtml(error.message || error)}
      </div>
    `;
  }
}

/* =========================
   EVENEMENTS GENERAUX
========================= */

document
  .getElementById("new-post-button")
  .addEventListener("click", openComposer);

document
  .getElementById("cancel-post")
  .addEventListener("click", closeComposer);

document
  .getElementById("publish-post")
  .addEventListener("click", createPost);

document
  .getElementById("close-edit-modal")
  .addEventListener("click", closeEditModal);

document
  .getElementById("cancel-edit")
  .addEventListener("click", closeEditModal);

document
  .getElementById("save-edit")
  .addEventListener("click", saveEdit);

document
  .querySelector(".modal-backdrop")
  .addEventListener("click", closeEditModal);

loadData();
