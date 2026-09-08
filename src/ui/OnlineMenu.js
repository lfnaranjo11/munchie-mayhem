import { normalizeRoomCode, MAX_PLAYERS } from '../network/protocol.js';

/**
 * OnlineMenu.js - joining an online match.
 *
 * Two entry paths, per the brief:
 *   - Room code: type a friend's code, or create one and share the link.
 *     The code is also written into the URL (?room=ABCD) so "send someone
 *     the link" works with no typing at all - which is how most people
 *     will actually do it on a phone.
 *   - Quick match: the server drops you into any public room with space,
 *     or opens a fresh one if none exist.
 */
export class OnlineMenu {
  constructor(root, profile) {
    this.root = root;
    this.profile = profile;
    this.onJoin = null;
    this.onCancel = null;
  }

  show(prefillCode = '') {
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="menu-card">
        <h1>Play Online</h1>
        <p class="subtitle">Up to ${MAX_PLAYERS} players. Empty seats are filled with bots.</p>

        <label class="online-field">Your name
          <input type="text" id="online-name" maxlength="12" placeholder="Player" />
        </label>

        <button id="quick-btn">Quick Match</button>
        <p class="online-or">or</p>

        <label class="online-field">Room code
          <input type="text" id="room-code" maxlength="4" placeholder="ABCD" value="${prefillCode}" autocomplete="off" />
        </label>
        <button id="join-btn" class="secondary">Join / Create Room</button>

        <p id="online-status" class="online-status"></p>
        <button id="back-btn" class="ghost">Back</button>
      </div>
    `;

    const codeInput = this.root.querySelector('#room-code');
    // Normalize as they type, so a lowercase or punctuated code still works.
    codeInput.addEventListener('input', () => {
      codeInput.value = normalizeRoomCode(codeInput.value);
    });

    this.root.querySelector('#quick-btn').addEventListener('click', () => {
      this.setStatus('Finding a match…');
      this.onJoin?.({ quick: true, name: this.getName() });
    });

    this.root.querySelector('#join-btn').addEventListener('click', () => {
      const code = normalizeRoomCode(codeInput.value);
      this.setStatus(code ? `Joining room ${code}…` : 'Creating a room…');
      this.onJoin?.({ roomCode: code, name: this.getName() });
    });

    this.root.querySelector('#back-btn').addEventListener('click', () => {
      this.root.style.display = 'none';
      this.onCancel?.();
    });
  }

  getName() {
    return this.root.querySelector('#online-name')?.value?.trim() || 'Player';
  }

  setStatus(text) {
    const el = this.root.querySelector('#online-status');
    if (el) el.textContent = text;
  }

  /** The waiting room: roster, share link, and a ready button. */
  showLobby(roomCode, players, onReady) {
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="menu-card">
        <h1>Room ${roomCode}</h1>
        <p class="subtitle">Share this link so friends can join:</p>
        <div class="share-row">
          <input type="text" id="share-url" readonly value="${shareUrl}" />
          <button id="copy-btn" class="secondary">Copy</button>
        </div>
        <ul id="lobby-players" class="lobby-list"></ul>
        <button id="ready-btn">I'm Ready</button>
        <p class="online-status" id="online-status">Waiting for everyone to be ready…</p>
      </div>
    `;

    this.updateLobby(players);

    this.root.querySelector('#copy-btn').addEventListener('click', async () => {
      const input = this.root.querySelector('#share-url');
      try {
        await navigator.clipboard.writeText(input.value);
        this.setStatus('Link copied!');
      } catch {
        // Clipboard API needs HTTPS and permission; selecting the text is
        // a reliable fallback so the player can copy it manually.
        input.select();
        this.setStatus('Press Ctrl/Cmd+C to copy the link.');
      }
    });

    this.root.querySelector('#ready-btn').addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Ready ✓';
      onReady?.();
    });
  }

  updateLobby(players = []) {
    const list = this.root.querySelector('#lobby-players');
    if (!list) return;
    const rows = players
      .map((p) => `<li>${p.name}${p.ready ? ' <span class="ready-tick">ready</span>' : ''}</li>`)
      .join('');
    const empty = Math.max(0, MAX_PLAYERS - players.length);
    list.innerHTML = rows + Array.from({ length: empty }, () => '<li class="empty-seat">open seat (bot)</li>').join('');
  }

  hide() {
    this.root.style.display = 'none';
  }
}

/** Reads ?room=ABCD so a shared link joins straight into that room. */
export function getRoomFromURL() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get('room') || '');
}

/** Server URL: ?server=... overrides, otherwise the configured default. */
export function getServerURL(defaultUrl) {
  return new URLSearchParams(window.location.search).get('server') || defaultUrl;
}
