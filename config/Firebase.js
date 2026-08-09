// firebase-admin v14 dropped the old namespaced API (admin.initializeApp,
// admin.apps, app.auth()) in favor of this modular one.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// The service account key is the JSON downloaded from Firebase Console ->
// Project Settings -> Service Accounts -> Generate new private key, stored
// as a single stringified-JSON env var (matching how other secrets in this
// project live in .env, and keeping the actual key file out of the repo).
let firebaseAuth = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert(serviceAccount) });

  firebaseAuth = getAuth(app);
} else {
  console.warn(
    "⚠️  FIREBASE_SERVICE_ACCOUNT_JSON not set - Google sign-in verification will fail until it's configured."
  );
}

export default firebaseAuth;
