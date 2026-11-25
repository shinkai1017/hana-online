
import {
    COLORS,
    COLOR_NAMES,
    FLOWER_NAMES,
    getCurrentPlayer,
    getScoreEvaluation,
    getEndReason,
    getCardImage,
    playCard,
    discardCard,
    giveHint,
    reorderHand
} from "./game.js";

const $ = id => document.getElementById(id);

let context = null;
let selectedCardId = null;
let busy = false;
let memoKey = "";

function playerName(uid) {

    const players = Object.values(
        context.room.players || {}
    );

    return players.find(p => p.uid === uid)?.name
        || "プレイヤー";

}

function myHand() {

    return context?.room.game.hands?.[context.uid]
        || [];

}

function myTurn() {

    return context?.room.game.status === "playing"
        && getCurrentPlayer(context.room.game)
            === context.uid;

}

// カードの生成

function createCard(card, options = {}) {

    const element = document.createElement(
        options.selectable ? "button" : "div"
    );

    element.className = "game-card";

    if (options.hidden) {

        element.classList.add("card-back");

        const number = document.createElement("span");
        number.className = "card-number";
        number.textContent = "?";

        element.append(number);

    } else {

        element.classList.add(`card-${card.color}`);

        const number = document.createElement("span");
        number.className = "card-number";
        number.textContent = card.number || "–";

        const label = document.createElement("span");
        label.className = "card-label";
        label.textContent = COLOR_NAMES[card.color];

        element.append(number, label);

        if (card.number > 0) {

            const image = document.createElement("img");

            image.alt =
                `${FLOWER_NAMES[card.color]} ${card.number}`;

            image.hidden = true;

            image.onload = () => {
                image.hidden = false;
            };

            image.onerror = () => {
                image.remove();
            };

            image.src = getCardImage(card);

            element.append(image);

        } else {

            element.classList.add("empty");

        }

    }

    if (options.hinted) {
        element.classList.add("hinted");
    }

    if (options.selectable) {

        element.type = "button";

        if (card.id === selectedCardId) {
            element.classList.add("selected");
        }

        element.onclick = () => {

            selectedCardId =
                selectedCardId === card.id
                    ? null
                    : card.id;

            renderHands();
            updateButtons();

        };

    }

    return element;

}

// 完成状況

function renderStacks(container, game) {

    container.replaceChildren();

    for (const color of COLORS) {

        container.append(
            createCard({
                color,
                number: game.stacks[color]
            })
        );

    }

}

// 手札の表示

function renderHands() {

    const { room, uid } = context;
    const game = room.game;

    const others = $("other-hands");
    const own = $("my-hand");

    others.replaceChildren();
    own.replaceChildren();

    const action = game.lastAction || {};

    const matched = action.type === "hint"
        ? action.matchedCards || []
        : [];

    for (const playerUid of game.playerOrder) {

        const hand = game.hands?.[playerUid] || [];

        if (playerUid === uid) {

            for (const card of hand) {

                own.append(
                    createCard(card, {
                        hidden: true,
                        selectable: true,
                        hinted:
                            action.targetUid === uid
                            && matched.includes(card.id)
                    })
                );

            }

            continue;

        }

        const panel = document.createElement("section");
        panel.className = "player-hand";

        const heading = document.createElement("h3");

        heading.textContent = playerName(playerUid);

        if (getCurrentPlayer(game) === playerUid) {
            heading.textContent += "（行動中）";
        }

        const row = document.createElement("div");
        row.className = "card-row";

        for (const card of hand) {

            row.append(
                createCard(card, {
                    hinted:
                        action.targetUid === playerUid
                        && matched.includes(card.id)
                })
            );

        }

        panel.append(heading, row);
        others.append(panel);

    }

}

// ヒント選択欄

function addOption(select, value, label) {

    const option = document.createElement("option");

    option.value = value;
    option.textContent = label;

    select.append(option);

}

function updateHintValues() {

    if (!context) return;

    const target = $("hint-target").value;
    const type = $("hint-type").value;
    const select = $("hint-value");

    const previous = select.value;

    select.replaceChildren();

    const hand =
        context.room.game.hands?.[target] || [];

    const values = type === "color"
        ? COLORS
        : [1, 2, 3, 4, 5];

    for (const value of values) {

        if (!hand.some(card => card[type] === value)) {
            continue;
        }

        addOption(
            select,
            value,
            type === "color"
                ? COLOR_NAMES[value]
                : value
        );

    }

    if (
        Array.from(select.options)
            .some(o => o.value === previous)
    ) {
        select.value = previous;
    }

    updateButtons();

}

function renderHintControls() {

    const select = $("hint-target");
    const previous = select.value;

    select.replaceChildren();

    for (const uid of context.room.game.playerOrder) {

        if (uid === context.uid) continue;

        addOption(select, uid, playerName(uid));

    }

    if (
        Array.from(select.options)
            .some(o => o.value === previous)
    ) {
        select.value = previous;
    }

    updateHintValues();

}

// ボタンの有効・無効

function updateButtons() {

    if (!context) return;

    const game = context.room.game;
    const hand = myHand();

    const index = hand.findIndex(
        card => card.id === selectedCardId
    );

    const canAct = !busy && myTurn();

    $("play-card").disabled =
        !canAct || index < 0;

    $("discard-card").disabled =
        !canAct || index < 0 || game.hints >= 8;

    $("give-hint").disabled =
        !canAct
        || game.hints <= 0
        || !$("hint-value").value;

    $("move-left").disabled =
        busy || index <= 0;

    $("move-right").disabled =
        busy || index < 0 || index >= hand.length - 1;

    $("hint-controls").hidden = !myTurn();

}

// 捨て札

function renderDiscard(game) {

    const container = $("discard-pile");

    container.replaceChildren();

    for (const color of COLORS) {

        const counts = [0, 0, 0, 0, 0];

        for (const card of game.discard || []) {

            if (card.color === color) {
                counts[card.number - 1]++;
            }

        }

        const line = document.createElement("div");

        line.textContent =
            `${COLOR_NAMES[color]}：`
            + counts.map((count, i) =>
                `${i + 1}×${count}`
            ).join("　");

        container.append(line);

    }

}

// 個人メモ

function renderMemo() {

    $("memo-section").hidden =
        context.room.mode !== "memo";

    const nextKey =
        `hana-memo-${context.roomId}-${context.uid}`;

    if (memoKey !== nextKey) {

        memoKey = nextKey;

        try {
            $("private-memo").value =
                sessionStorage.getItem(memoKey) || "";
        } catch {
            $("private-memo").value = "";
        }

    }

}

// ゲーム画面の更新

export function renderGame(roomId, room, uid) {

    context = { roomId, room, uid };

    const game = room.game;

    if (!myHand().some(c => c.id === selectedCardId)) {
        selectedCardId = null;
    }

    $("game-score").textContent =
        `${game.score} / 25`;

    $("game-hints").textContent =
        `${game.hints} / 8`;

    $("game-mistakes").textContent =
        `${game.mistakes} / 3`;

    $("deck-count").textContent =
        (game.deck || []).length;

    $("turn-display").textContent = myTurn()
        ? "あなたのターンです"
        : `${playerName(getCurrentPlayer(game))}のターン`;

    $("final-turns").textContent =
        game.finalTurns >= 0
            ? `最終ラウンド：残り${game.finalTurns}ターン`
            : "";

    const action = game.lastAction || {};

    $("last-action").textContent = action.uid
        ? `${playerName(action.uid)}：${action.message}`
        : "";

    $("received-hint").textContent =
        action.type === "hint"
        && action.targetUid === uid
            ? (
                action.hintType === "color"
                    ? `強調されたカードは${COLOR_NAMES[action.value]}です。`
                    : `強調されたカードは${action.value}です。`
            )
            : "";

    renderStacks($("stacks"), game);
    renderHands();
    renderHintControls();
    renderDiscard(game);
    renderMemo();
    updateButtons();

}

// 操作の実行

async function execute(action) {

    if (busy || !context) return;

    busy = true;
    updateButtons();

    try {

        await action();

    } catch (error) {

        alert(error.message);

    } finally {

        busy = false;
        updateButtons();

    }

}

function moveCard(direction) {

    if (!context || busy) return;

    const ids = myHand().map(card => card.id);

    const index = ids.indexOf(selectedCardId);
    const next = index + direction;

    if (index < 0 || next < 0 || next >= ids.length) {
        return;
    }

    [ids[index], ids[next]] =
        [ids[next], ids[index]];

    execute(() =>
        reorderHand(
            context.roomId,
            context.uid,
            ids
        )
    );

}

// イベント登録

export function initializeGameUI() {

    $("play-card").onclick = () => {

        if (!myTurn() || !selectedCardId) return;

        execute(() =>
            playCard(
                context.roomId,
                context.uid,
                selectedCardId,
                context.room.game.turnNumber
            )
        );

    };

    $("discard-card").onclick = () => {

        if (!myTurn() || !selectedCardId) return;

        execute(() =>
            discardCard(
                context.roomId,
                context.uid,
                selectedCardId,
                context.room.game.turnNumber
            )
        );

    };

    $("give-hint").onclick = () => {

        if (!myTurn()) return;

        const type = $("hint-type").value;

        const value = type === "number"
            ? Number($("hint-value").value)
            : $("hint-value").value;

        execute(() =>
            giveHint(
                context.roomId,
                context.uid,
                $("hint-target").value,
                type,
                value,
                context.room.game.turnNumber
            )
        );

    };

    $("hint-target").onchange = updateHintValues;
    $("hint-type").onchange = updateHintValues;

    $("move-left").onclick = () => moveCard(-1);
    $("move-right").onclick = () => moveCard(1);

    $("private-memo").oninput = () => {

        if (!memoKey) return;

        try {
            sessionStorage.setItem(
                memoKey,
                $("private-memo").value
            );
        } catch {
            // 保存不可でも入力自体は継続
        }

    };

}

// ゲーム終了画面

export function renderResult(room, uid) {

    const game = room.game;

    $("result-score").textContent =
        `${game.score} / 25`;

    $("result-evaluation").textContent =
        getScoreEvaluation(game.score);

    $("result-reason").textContent =
        getEndReason(game.endReason);

    renderStacks($("result-stacks"), game);

    $("return-lobby").hidden =
        room.host !== uid;

}

// ゲーム画面の初期化

export function resetGameUI() {

    if (memoKey) {

        try {
            sessionStorage.removeItem(memoKey);
        } catch {
            // 保存領域が利用できない場合
        }

    }

    context = null;
    selectedCardId = null;
    busy = false;
    memoKey = "";

    $("private-memo").value = "";

}
