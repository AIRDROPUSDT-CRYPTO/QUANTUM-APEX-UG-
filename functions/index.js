const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

/* ✅ CORRECT PERCENTAGES */
const PLANS = {
  150000: 0.15,
  500000: 0.25,
  1000000: 0.35,
  5000000: 0.45
};

const DAYS = 12;
const DAY_MS = 86400000;

/* 🔒 INVEST */
exports.investPlan = functions.https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const uid = context.auth.uid;
  const amount = Number(data.amount);

  if (!PLANS[amount]) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid plan selected");
  }

  const percent = PLANS[amount];
  const daily = amount * percent;
  const total = daily * DAYS;

  const userRef = db.ref("users/" + uid);
  const investRef = db.ref(`investments/${uid}/12days/${amount}`);

  const userSnap = await userRef.get();
  const user = userSnap.val();

  if (!user || (user.balance || 0) < amount) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Insufficient balance to invest"
    );
  }

  const existing = await investRef.get();
  if (existing.exists()) {
    throw new functions.https.HttpsError(
      "already-exists",
      "You already invested in this plan"
    );
  }

  /* ✅ SAFE UPDATE */
  await userRef.update({
    balance: (user.balance || 0) - amount,
    lockedBalance: (user.lockedBalance || 0) + total
  });

  await investRef.set({
    amount,
    daily,
    total,
    remaining: total,
    startTime: Date.now(),
    lastClaim: 0,
    daysClaimed: 0,
    completed: false
  });

  return { success: true };
});


/* 🔒 CLAIM */
exports.claimEarnings = functions.https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const uid = context.auth.uid;
  const amount = Number(data.amount);

  const investRef = db.ref(`investments/${uid}/12days/${amount}`);
  const userRef = db.ref("users/" + uid);

  const snap = await investRef.get();
  const inv = snap.val();

  if (!inv) {
    throw new functions.https.HttpsError("not-found", "No investment found");
  }

  const last = inv.lastClaim || inv.startTime;

  if (Date.now() < last + DAY_MS) {
    throw new functions.https.HttpsError("failed-precondition", "Not yet time");
  }

  if (inv.completed) {
    throw new functions.https.HttpsError("failed-precondition", "Plan completed");
  }

  const payout = Math.floor(inv.daily);

  await investRef.update({
    lastClaim: Date.now(),
    daysClaimed: inv.daysClaimed + 1,
    remaining: inv.remaining - payout,
    completed: inv.daysClaimed + 1 >= DAYS
  });

  const userSnap = await userRef.get();
  const user = userSnap.val();

  await userRef.update({
    balance: (user.balance || 0) + payout,
    lockedBalance: (user.lockedBalance || 0) - payout
  });

  return { success: true, payout };
});
