

import {
    auth,
    db,
    signInAnonymously,
    ref,
    set,
    get,
    remove
} from "./firebase.js";

const authStatus = document.getElementById("auth-status");
const dbStatus = document.getElementById("db-status");
const userId = document.getElementById("user-id");

async function connectionTest() {
    let user;

    try {
        const credential = await signInAnonymously(auth);
        user = credential.user;

        authStatus.textContent = "匿名認証：成功";
        authStatus.style.color = "green";

        userId.textContent = "UID: " + user.uid;

    } catch (error) {
        authStatus.textContent = "匿名認証：失敗";
        authStatus.style.color = "red";
        dbStatus.textContent = "データベース：未確認";
        console.error(error);
        return;
    }

    try {
        const testRef = ref(db, "connectionTest/" + user.uid);
        const testValue = Date.now();

        await set(testRef, testValue);

        const snapshot = await get(testRef);

        if (snapshot.val() !== testValue) {
            throw new Error("データの不一致");
        }

        await remove(testRef);

        dbStatus.textContent = "データベース：接続成功";
        dbStatus.style.color = "green";

    } catch (error) {
        dbStatus.textContent = "データベース：接続失敗";
        dbStatus.style.color = "red";
        console.error(error);
    }
}

connectionTest();
