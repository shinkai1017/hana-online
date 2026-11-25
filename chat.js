
import {
    db,
    ref,
    push,
    onValue,
    query,
    limitToLast,
    serverTimestamp
} from "./firebase.js";

export async function sendMessage(roomId, uid, name, text) {
    text = text.trim();

    if (!text || text.length > 300) return;

    await push(ref(db, `rooms/${roomId}/chat`), {
        uid,
        name,
        text,
        time: serverTimestamp()
    });
}

export function watchChat(roomId, container) {
    const chatQuery = query(
        ref(db, `rooms/${roomId}/chat`),
        limitToLast(100)
    );

    return onValue(chatQuery, snapshot => {
        container.replaceChildren();

        snapshot.forEach(child => {
            const message = child.val();
            const element = document.createElement("div");

            element.className = "chat-message";

            const time = new Date(message.time)
                .toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit"
                });

            element.textContent =
                `${time} ${message.name}：${message.text}`;

            container.appendChild(element);
        });

        container.scrollTop = container.scrollHeight;
    });
}
