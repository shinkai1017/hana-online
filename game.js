

// ========================================
// HANA ONLINE - Game System
// ========================================

import {
    db,
    ref,
    runTransaction
} from "./firebase.js";

// ========================================
// 基本設定
// ========================================

export const COLORS = [
    "white",
    "blue",
    "red",
    "green",
    "yellow"
];

export const COLOR_NAMES = {
    white: "白",
    blue: "青",
    red: "赤",
    green: "緑",
    yellow: "黄"
};

export const FLOWER_NAMES = {
    white: "ジャスミン",
    blue: "ネモフィラ",
    red: "カンザン",
    green: "ジニア",
    yellow: "ミモザ"
};

export const MAX_HINTS = 8;
export const MAX_MISTAKES = 3;
export const MAX_SCORE = 25;

// ========================================
// 山札の生成
// ========================================

export function createDeck() {

    const deck = [];
    const counts = [3, 2, 2, 2, 1];

    for (const color of COLORS) {

        for (let number = 1; number <= 5; number++) {

            for (let i = 0; i < counts[number - 1]; i++) {

                deck.push({
                    id: `${color}_${number}_${i}`,
                    color: color,
                    number: number
                });

            }

        }

    }

    return deck;
}

// ========================================
// シャッフル
// ========================================

export function shuffleDeck(deck) {

    const result = [...deck];

    for (let i = result.length - 1; i > 0; i--) {

        const j = Math.floor(Math.random() * (i + 1));

        [result[i], result[j]] =
            [result[j], result[i]];

    }

    return result;
}

// ========================================
// ゲームデータの生成
// ========================================

export function createGameData(players, hostUid) {

    const playerOrder = Object.keys(players)
        .sort()
        .map(slot => players[slot].uid);

    const playerCount = playerOrder.length;

    if (playerCount < 2 || playerCount > 5) {
        throw new Error("プレイヤー人数が不正です。");
    }

    const hostIndex = playerOrder.indexOf(hostUid);

    if (hostIndex === -1) {
        throw new Error("ホストが見つかりません。");
    }

    const handSize = playerCount <= 3 ? 5 : 4;

    const deck = shuffleDeck(createDeck());

    const hands = {};

    for (const uid of playerOrder) {
        hands[uid] = [];
    }

    for (let i = 0; i < handSize; i++) {

        for (const uid of playerOrder) {
            hands[uid].push(deck.pop());
        }

    }

    return {
        playerOrder: playerOrder,
        turnIndex: hostIndex,
        turnNumber: 1,

        deck: deck,
        hands: hands,
        discard: [],

        stacks: {
            white: 0,
            blue: 0,
            red: 0,
            green: 0,
            yellow: 0
        },

        hints: MAX_HINTS,
        mistakes: 0,
        score: 0,

        finalTurns: -1,

        status: "playing",
        endReason: "",

        lastAction: {
            type: "start",
            uid: hostUid,
            message: "ゲームが開始されました。"
        }
    };
}

// ========================================
// 現在のプレイヤー
// ========================================

export function getCurrentPlayer(game) {

    return game.playerOrder[game.turnIndex];

}

// ========================================
// スコア計算
// ========================================

export function calculateScore(game) {

    return COLORS.reduce(
        (total, color) => total + game.stacks[color],
        0
    );

}

// ========================================
// スコア評価
// ========================================

export function getScoreEvaluation(score) {

    if (score <= 5) {
        return "観衆から野次が飛ぶ";
    }

    if (score <= 10) {
        return "平凡。拍手がちらほら。";
    }

    if (score <= 15) {
        return "素晴らしいが、記憶には残らない。";
    }

    if (score <= 20) {
        return "非常に素晴らしい。観衆も大喜び。";
    }

    if (score <= 24) {
        return "極上の出来。みんなの記憶に長く残る。";
    }

    return "伝説級。誰もが目を輝かせ、言葉を飲み込む。";
}

// ========================================
// データの補正
// Firebaseでは空配列が消える場合がある
// ========================================

function normalizeGame(game) {

    game.deck = game.deck || [];
    game.discard = game.discard || [];
    game.hands = game.hands || {};

    for (const uid of game.playerOrder) {
        game.hands[uid] = game.hands[uid] || [];
    }

    return game;
}

// ========================================
// ゲーム終了
// ========================================

function finishGame(game, reason) {

    game.status = "finished";
    game.endReason = reason;
    game.score = calculateScore(game);

}

// ========================================
// カードの補充
// ========================================

function drawCard(game, uid) {

    if (game.deck.length === 0) {
        return;
    }

    const card = game.deck.pop();

    // 新しいカードは必ず右端
    game.hands[uid].push(card);

    // 最後のカードを引いた場合
    if (game.deck.length === 0) {

        game.finalTurns = game.playerOrder.length;

    }
}

// ========================================
// ターン終了処理
// ========================================

function finishTurn(game, wasFinalRound) {

    game.score = calculateScore(game);

    if (game.score === MAX_SCORE) {

        finishGame(game, "perfect");
        return;

    }

    if (game.mistakes >= MAX_MISTAKES) {

        finishGame(game, "mistakes");
        return;

    }

    // 山札がなくなった後の残りターン
    if (wasFinalRound) {

        game.finalTurns--;

        if (game.finalTurns <= 0) {

            finishGame(game, "deck");
            return;

        }

    }

    game.turnIndex =
        (game.turnIndex + 1) % game.playerOrder.length;

    game.turnNumber++;

}

// ========================================
// アクションの共通チェック
// ========================================

function validateTurn(game, uid) {

    if (game.status !== "playing") {
        throw new Error("ゲームは終了しています。");
    }

    if (getCurrentPlayer(game) !== uid) {
        throw new Error("あなたのターンではありません。");
    }

}

// ========================================
// 手札からカードを取り出す
// ========================================

function takeCard(game, uid, cardId) {

    const hand = game.hands[uid];

    const index = hand.findIndex(
        card => card.id === cardId
    );

    if (index === -1) {
        throw new Error("カードが見つかりません。");
    }

    return hand.splice(index, 1)[0];

}

// ========================================
// カードの提出
// ========================================

function applyPlay(game, uid, cardId) {

    validateTurn(game, uid);

    const wasFinalRound = game.finalTurns >= 0;

    const card = takeCard(game, uid, cardId);

    const expectedNumber =
        game.stacks[card.color] + 1;

    const success = card.number === expectedNumber;

    if (success) {

        game.stacks[card.color] = card.number;

        // 5を完成させるとヒントが1回復
        if (card.number === 5) {

            game.hints = Math.min(
                MAX_HINTS,
                game.hints + 1
            );

        }

    } else {

        game.mistakes++;
        game.discard.push(card);

    }

    game.lastAction = {
        type: "play",
        uid: uid,
        card: card,
        success: success,
        message: success
            ? `${COLOR_NAMES[card.color]}の${card.number}の提出に成功しました。`
            : `${COLOR_NAMES[card.color]}の${card.number}の提出に失敗しました。`
    };

    if (
        game.mistakes < MAX_MISTAKES &&
        calculateScore(game) < MAX_SCORE
    ) {

        drawCard(game, uid);

    }

    finishTurn(game, wasFinalRound);

    return game;
}

// ========================================
// カードの破棄
// ========================================

function applyDiscard(game, uid, cardId) {

    validateTurn(game, uid);

    if (game.hints >= MAX_HINTS) {

        throw new Error(
            "ヒントトークンが最大のため破棄できません。"
        );

    }

    const wasFinalRound = game.finalTurns >= 0;

    const card = takeCard(game, uid, cardId);

    game.discard.push(card);

    game.hints = Math.min(
        MAX_HINTS,
        game.hints + 1
    );

    game.lastAction = {
        type: "discard",
        uid: uid,
        card: card,
        message:
            `${COLOR_NAMES[card.color]}の${card.number}を破棄しました。`
    };

    drawCard(game, uid);

    finishTurn(game, wasFinalRound);

    return game;
}

// ========================================
// ヒント
// ========================================

function applyHint(game, uid, targetUid, type, value) {

    validateTurn(game, uid);

    if (game.hints <= 0) {
        throw new Error("ヒントトークンがありません。");
    }

    if (uid === targetUid) {
        throw new Error("自分にはヒントを出せません。");
    }

    if (!game.playerOrder.includes(targetUid)) {
        throw new Error("対象プレイヤーが存在しません。");
    }

    if (type !== "color" && type !== "number") {
        throw new Error("ヒントの種類が不正です。");
    }

    if (type === "color" && !COLORS.includes(value)) {
        throw new Error("色の指定が不正です。");
    }

    if (
        type === "number" &&
        (!Number.isInteger(value) || value < 1 || value > 5)
    ) {
        throw new Error("数字の指定が不正です。");
    }

    const wasFinalRound = game.finalTurns >= 0;

    const matchedCards = game.hands[targetUid]
        .filter(card => card[type] === value)
        .map(card => card.id);

    if (matchedCards.length === 0) {

        throw new Error(
            "指定された色または数字のカードがありません。"
        );

    }

    game.hints--;

    game.lastAction = {
        type: "hint",
        uid: uid,
        targetUid: targetUid,
        hintType: type,
        value: value,
        matchedCards: matchedCards,
        message: type === "color"
            ? `${COLOR_NAMES[value]}のヒントを出しました。`
            : `${value}のヒントを出しました。`
    };

    finishTurn(game, wasFinalRound);

    return game;
}

// ========================================
// 手札の並べ替え
// ========================================

function applyReorder(game, uid, orderedIds) {

    if (game.status !== "playing") {
        throw new Error("ゲームは終了しています。");
    }

    if (!game.playerOrder.includes(uid)) {
        throw new Error("プレイヤーが存在しません。");
    }

    const hand = game.hands[uid];

    if (orderedIds.length !== hand.length) {
        throw new Error("カードの枚数が一致しません。");
    }

    if (new Set(orderedIds).size !== hand.length) {
        throw new Error("カードが重複しています。");
    }

    const reordered = orderedIds.map(id =>
        hand.find(card => card.id === id)
    );

    if (reordered.some(card => !card)) {
        throw new Error("カードが見つかりません。");
    }

    game.hands[uid] = reordered;

    // ターンを消費しない
    // lastActionも変更しない

    return game;
}

// ========================================
// Firebase：ゲーム開始
// ========================================

export async function startGame(roomId, uid) {

    const roomRef = ref(db, `rooms/${roomId}`);

    return runTransaction(roomRef, room => {

        if (!room) {
            return;
        }

        if (room.host !== uid) {
            return;
        }

        if (room.state !== "waiting") {
            return;
        }

        const players = room.players || {};

        if (Object.keys(players).length !== room.maxPlayers) {
            return;
        }

        room.game = createGameData(players, uid);
        room.state = "playing";

        return room;

    }, {
        applyLocally: false
    });

}

// ========================================
// Firebase：共通アクション処理
// ========================================

async function updateGame(roomId, uid, action) {

    const roomRef = ref(db, `rooms/${roomId}`);

    let errorMessage = "";

    const result = await runTransaction(roomRef, room => {

        errorMessage = "";

        if (!room) {

            errorMessage = "ルームが存在しません。";
            return;

        }

        if (room.state !== "playing" || !room.game) {

            errorMessage = "ゲームが開始されていません。";
            return;

        }

        try {

            const game = normalizeGame(room.game);

            if (!game.playerOrder.includes(uid)) {
                throw new Error("参加者ではありません。");
            }

            // 古いターンの操作を拒否
            if (
                action.type !== "reorder" &&
                action.turnNumber !== game.turnNumber
            ) {
                throw new Error("ターンが変更されています。");
            }

            switch (action.type) {

                case "play":

                    room.game = applyPlay(
                        game,
                        uid,
                        action.cardId
                    );

                    break;

                case "discard":

                    room.game = applyDiscard(
                        game,
                        uid,
                        action.cardId
                    );

                    break;

                case "hint":

                    room.game = applyHint(
                        game,
                        uid,
                        action.targetUid,
                        action.hintType,
                        action.value
                    );

                    break;

                case "reorder":

                    room.game = applyReorder(
                        game,
                        uid,
                        action.orderedIds
                    );

                    break;

                default:

                    throw new Error("不明な操作です。");

            }

            if (room.game.status === "finished") {
                room.state = "finished";
            }

            return room;

        } catch (error) {

            errorMessage = error.message;
            return;

        }

    }, {
        applyLocally: false
    });

    if (!result.committed) {

        throw new Error(
            errorMessage || "操作を完了できませんでした。"
        );

    }

    return result;
}

// ========================================
// 外部から呼び出す操作関数
// ========================================

export function playCard(
    roomId, uid, cardId, turnNumber
) {

    return updateGame(roomId, uid, {
        type: "play",
        cardId: cardId,
        turnNumber: turnNumber
    });

}

export function discardCard(
    roomId, uid, cardId, turnNumber
) {

    return updateGame(roomId, uid, {
        type: "discard",
        cardId: cardId,
        turnNumber: turnNumber
    });

}

export function giveHint(
    roomId, uid, targetUid, type, value, turnNumber
) {

    return updateGame(roomId, uid, {
        type: "hint",
        targetUid: targetUid,
        hintType: type,
        value: value,
        turnNumber: turnNumber
    });

}

export function reorderHand(roomId, uid, orderedIds) {

    return updateGame(roomId, uid, {
        type: "reorder",
        orderedIds: orderedIds
    });

}

// ========================================
// カード画像のパス
// ========================================

export function getCardImage(card) {

    return `./images/${card.color}_${card.number}.png`;

}

// ========================================
// 終了理由
// ========================================

export function getEndReason(reason) {

    switch (reason) {

        case "perfect":
            return "すべての花が咲き揃いました。";

        case "mistakes":
            return "ミスが3回に達しました。";

        case "deck":
            return "山札がなくなり、最終ターンが終了しました。";

        default:
            return "ゲームが終了しました。";

    }

}
