
import {
    auth,
    db,
    signInAnonymously,
    ref,
    get,
    remove,
    onValue,
    runTransaction
} from "./firebase.js";

import {
    sendMessage,
    watchChat
} from "./chat.js";

const $ = id => document.getElementById(id);

let user = null;
let roomId = null;
let playerSlot = null;
let playerName = "";
let stopRoom = null;
let stopChat = null;
let busy = false;

function status(text) {
    $("status").textContent = text;
}

function showScreen(screen) {
    $("title-screen").hidden = screen !== "title";
    $("lobby-screen").hidden = screen !== "lobby";
}

function readName() {
    const name = $("player-name").value.trim();

    if (!name || name.length > 20) {
        throw new Error("プレイヤー名を入力してください。");
    }

    return name;
}

function generateRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const values = crypto.getRandomValues(new Uint32Array(6));

    return Array.from(
        values,
        value => chars[value % chars.length]
    ).join("");
}

async function createRoom() {
    const name = readName();
    const maxPlayers = Number($("player-count").value);
    const mode = $("game-mode").value;

    for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomId();

        const result = await runTransaction(
            ref(db, `rooms/${code}`),
            current => {
                if (current !== null) return;

                return {
                    host: user.uid,
                    maxPlayers,
                    mode,
                    state: "waiting",
                    createdAt: Date.now(),
                    players: {
                        s0: {
                            uid: user.uid,
                            name
                        }
                    }
                };
            },
            { applyLocally: false }
        );

        if (result.committed) {
            enterLobby(code, "s0", name);
            return;
        }
    }

    throw new Error("ルームを作成できませんでした。");
}

async function joinRoom() {
    const name = readName();
    const code = $("room-input").value.trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(code)) {
        throw new Error("6桁のルームIDを入力してください。");
    }

    const snapshot = await get(ref(db, `rooms/${code}`));

    if (!snapshot.exists()) {
        throw new Error("ルームが存在しません。");
    }

    const room = snapshot.val();

    if (room.state !== "waiting") {
        throw new Error("ゲームは既に開始されています。");
    }

    const players = room.players || {};

    for (const [slot, player] of Object.entries(players)) {
        if (player.uid === user.uid) {
            enterLobby(code, slot, player.name);
            return;
        }
    }

    for (let i = 0; i < room.maxPlayers; i++) {
        const slot = `s${i}`;

        if (players[slot]) continue;

        const result = await runTransaction(
            ref(db, `rooms/${code}/players/${slot}`),
            current => {
                if (current !== null) return;

                return {
                    uid: user.uid,
                    name
                };
            },
            { applyLocally: false }
        );

        if (result.committed) {
            enterLobby(code, slot, name);
            return;
        }
    }

    throw new Error("ルームが満員です。");
}

function enterLobby(code, slot, name) {
    roomId = code;
    playerSlot = slot;
    playerName = name;

    $("room-code").textContent = code;

    showScreen("lobby");
    status("ルームに接続しました。");

    stopRoom = onValue(
        ref(db, `rooms/${code}`),
        snapshot => {
            if (!snapshot.exists()) {
                closeLobby();
                status("ルームが閉じられました。");
                return;
            }

            const room = snapshot.val();
            const players = Object.values(room.players || {});

            const modeName = room.mode === "memo"
                ? "メモモード"
                : "ノーマルモード";

            $("room-info").textContent =
                `${modeName}・${players.length}/${room.maxPlayers}人`;

            $("player-list").replaceChildren();

            for (const player of players) {
                const li = document.createElement("li");

                li.textContent = player.name
                    + (player.uid === room.host ? " [HOST]" : "")
                    + (player.uid === user.uid ? " [YOU]" : "");

                $("player-list").appendChild(li);
            }

            for (let i = players.length; i < room.maxPlayers; i++) {
                const li = document.createElement("li");
                li.textContent = "参加者待機中...";
                $("player-list").appendChild(li);
            }

            $("start-game").hidden = room.host !== user.uid;
        },
        error => status(error.message)
    );

    stopChat = watchChat(code, $("chat-log"));
}

function closeLobby() {
    if (stopRoom) stopRoom();
    if (stopChat) stopChat();

    stopRoom = null;
    stopChat = null;
    roomId = null;
    playerSlot = null;

    $("chat-log").replaceChildren();
    showScreen("title");
}

async function leaveRoom() {
    if (!roomId) return;

    const roomRef = ref(db, `rooms/${roomId}`);
    const snapshot = await get(roomRef);

    if (snapshot.val()?.host === user.uid) {
        await remove(roomRef);
    } else {
        await remove(
            ref(db, `rooms/${roomId}/players/${playerSlot}`)
        );
    }

    closeLobby();
    status("ルームから退出しました。");
}

async function execute(action) {
    if (busy) return;

    busy = true;

    try {
        await action();
    } catch (error) {
        status(error.message);
        console.error(error);
    } finally {
        busy = false;
    }
}

$("create-room").onclick = () => execute(createRoom);
$("join-room").onclick = () => execute(joinRoom);
$("leave-room").onclick = () => execute(leaveRoom);

$("copy-room").onclick = () => execute(async () => {
    await navigator.clipboard.writeText(roomId);
    status("ルームIDをコピーしました。");
});

$("chat-form").onsubmit = event => {
    event.preventDefault();

    execute(async () => {
        if (!roomId) return;

        const text = $("chat-input").value;

        await sendMessage(
            roomId,
            user.uid,
            playerName,
            text
        );

        $("chat-input").value = "";
    });
};

async function initialize() {
    try {
        const credential = await signInAnonymously(auth);
        user = credential.user;

        status("接続完了");
        showScreen("title");

    } catch (error) {
        status("接続失敗：" + error.message);
        console.error(error);
    }
}

initialize();
