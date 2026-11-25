
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

import {
    startGame
} from "./game.js";

import {
    initializeGameUI,
    renderGame,
    renderResult,
    resetGameUI
} from "./game-ui.js";

const $ = id => document.getElementById(id);

let user = null;
let roomId = null;
let playerSlot = null;
let playerName = "";

let stopRoom = null;
let stopChat = null;
let currentRoom = null;

let busy = false;

// 初期接続

async function initialize() {

    try {

        const credential =
            await signInAnonymously(auth);

        user = credential.user;

        $("status").textContent = "接続済み";
        $("title-screen").hidden = false;

    } catch (error) {

        $("status").textContent =
            `接続エラー：${error.message}`;

        console.error(error);

    }

}

// ルームIDの生成

function generateRoomId() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    const values = new Uint32Array(6);

    crypto.getRandomValues(values);

    return Array.from(values)
        .map(v => chars[v % chars.length])
        .join("");

}

// 名前の取得

function readName() {

    const name = $("player-name").value.trim();

    if (!name || name.length > 20) {

        throw new Error(
            "プレイヤー名を1～20文字で入力してください。"
        );

    }

    return name;

}

// 共通処理

async function execute(action) {

    if (busy) return;

    busy = true;

    try {

        await action();

    } catch (error) {

        console.error(error);
        alert(error.message);

    } finally {

        busy = false;

    }

}

// ルーム作成

async function createRoom() {

    const name = readName();

    const maxPlayers =
        Number($("player-count").value);

    const mode = $("game-mode").value;

    for (let i = 0; i < 5; i++) {

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

            enterRoom(code, "s0", name);
            return;

        }

    }

    throw new Error("ルームを作成できませんでした。");

}

// ルーム参加

async function joinRoom() {

    const name = readName();

    const code =
        $("room-input").value.trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(code)) {

        throw new Error(
            "6文字のルームIDを入力してください。"
        );

    }

    const roomRef = ref(db, `rooms/${code}`);

    const snapshot = await get(roomRef);
    const room = snapshot.val();

    if (!room) {
        throw new Error("ルームが見つかりません。");
    }

    // 既に参加している場合は再接続

    const existing = Object.entries(
        room.players || {}
    ).find(([, player]) => player.uid === user.uid);

    if (existing) {

        enterRoom(
            code,
            existing[0],
            existing[1].name
        );

        return;

    }

    if (room.state !== "waiting") {

        throw new Error(
            "このルームでは既にゲームが始まっています。"
        );

    }

    let joinedSlot = null;

    const result = await runTransaction(

        roomRef,

        current => {

            joinedSlot = null;

            if (!current || current.state !== "waiting") {
                return;
            }

            current.players = current.players || {};

            const existingPlayer = Object.entries(
                current.players
            ).find(([, p]) => p.uid === user.uid);

            if (existingPlayer) {

                joinedSlot = existingPlayer[0];
                return current;

            }

            for (let i = 0; i < current.maxPlayers; i++) {

                const slot = `s${i}`;

                if (!current.players[slot]) {

                    current.players[slot] = {
                        uid: user.uid,
                        name
                    };

                    joinedSlot = slot;

                    return current;

                }

            }

            return;

        },

        { applyLocally: false }

    );

    if (!result.committed || !joinedSlot) {

        throw new Error(
            "参加できませんでした。満員の可能性があります。"
        );

    }

    const savedPlayer =
        result.snapshot.val().players[joinedSlot];

    enterRoom(code, joinedSlot, savedPlayer.name);

}

// ルームに入る

function enterRoom(code, slot, name) {

    if (stopRoom) stopRoom();
    if (stopChat) stopChat();

    roomId = code;
    playerSlot = slot;
    playerName = name;

    $("title-screen").hidden = true;
    $("room-screen").hidden = false;

    $("room-code").textContent = code;

    stopRoom = onValue(

        ref(db, `rooms/${code}`),

        snapshot => {

            const room = snapshot.val();

            if (!room) {

                closeRoom();
                alert("ルームが閉じられました。");
                return;

            }

            if (
                room.players?.[playerSlot]?.uid
                    !== user.uid
            ) {

                closeRoom();
                return;

            }

            updateRoom(room);

        },

        error => {

            console.error(error);
            alert(error.message);

        }

    );

    stopChat = watchChat(
        code,
        $("chat-log")
    );

}

// 画面の切り替え

function updateRoom(room) {

    const previousState = currentRoom?.state;

    currentRoom = room;

    const players = Object.entries(
        room.players || {}
    ).sort(([a], [b]) => a.localeCompare(b));

    const isHost = room.host === user.uid;

    const modeName = room.mode === "memo"
        ? "メモモード"
        : "ノーマルモード";

    $("room-info").textContent =
        `${players.length} / ${room.maxPlayers}人`
        + `　${modeName}`;

    $("lobby-screen").hidden =
        room.state !== "waiting";

    $("game-screen").hidden =
        room.state !== "playing";

    $("result-screen").hidden =
        room.state !== "finished";

    if (room.state === "waiting") {

        if (previousState !== "waiting") {
            resetGameUI();
        }

        const list = $("player-list");

        list.replaceChildren();

        for (const [, player] of players) {

            const item = document.createElement("li");

            item.textContent =
                player.name
                + (player.uid === room.host
                    ? "（ホスト）"
                    : "");

            list.append(item);

        }

        $("start-game").hidden = !isHost;

        $("start-game").disabled =
            players.length !== room.maxPlayers;

    }

    if (room.state === "playing" && room.game) {

        renderGame(roomId, room, user.uid);

    }

    if (room.state === "finished" && room.game) {

        renderResult(room, user.uid);

    }

}

// ゲーム開始

async function beginGame() {

    if (!roomId) return;

    const result = await startGame(roomId, user.uid);

    if (!result.committed) {

        throw new Error(
            "ゲームを開始できませんでした。"
        );

    }

}

// 再戦用ロビー

async function returnLobby() {

    if (!roomId) return;

    const result = await runTransaction(

        ref(db, `rooms/${roomId}`),

        room => {

            if (!room || room.host !== user.uid) {
                return;
            }

            if (room.state !== "finished") {
                return;
            }

            room.state = "waiting";

            delete room.game;

            return room;

        },

        { applyLocally: false }

    );

    if (!result.committed) {

        throw new Error(
            "ロビーに戻れませんでした。"
        );

    }

}

// 退出

async function leaveRoom() {

    if (!roomId) return;

    if (
        currentRoom?.state === "playing"
        && !confirm("ゲームを中断して退出しますか？")
    ) {
        return;
    }

    const code = roomId;
    const slot = playerSlot;

    const result = await runTransaction(

        ref(db, `rooms/${code}`),

        room => {

            if (!room) return;

            if (room.host === user.uid) {
                return null;
            }

            if (room.players?.[slot]?.uid !== user.uid) {
                return;
            }

            delete room.players[slot];

            // ゲーム中の退出は全員をロビーに戻す

            if (room.state === "playing") {

                room.state = "waiting";
                delete room.game;

            }

            return room;

        },

        { applyLocally: false }

    );

    if (!result.committed) {

        throw new Error("退出できませんでした。");

    }

    closeRoom();

}

// ローカル画面を閉じる

function closeRoom() {

    if (stopRoom) stopRoom();
    if (stopChat) stopChat();

    stopRoom = null;
    stopChat = null;

    roomId = null;
    playerSlot = null;
    playerName = "";
    currentRoom = null;

    resetGameUI();

    $("chat-log").replaceChildren();

    $("room-screen").hidden = true;
    $("title-screen").hidden = false;

}

// イベント登録

$("create-room").onclick =
    () => execute(createRoom);

$("join-room").onclick =
    () => execute(joinRoom);

$("start-game").onclick =
    () => execute(beginGame);

$("return-lobby").onclick =
    () => execute(returnLobby);

$("leave-room").onclick =
    () => execute(leaveRoom);

$("copy-room").onclick = () => execute(async () => {

    if (!roomId) return;

    await navigator.clipboard.writeText(roomId);

    alert("ルームIDをコピーしました。");

});

$("chat-form").onsubmit = event => {

    event.preventDefault();

    execute(async () => {

        if (!roomId) return;

        const input = $("chat-input");

        const message = input.value.trim();

        if (!message) return;

        await sendMessage(
            roomId,
            user.uid,
            playerName,
            message
        );

        input.value = "";

    });

};

initializeGameUI();
initialize();

