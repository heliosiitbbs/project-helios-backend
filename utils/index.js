import { initializeApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCdRlc-YjjiQ248wHQue8yyhG-oUI2ZZ20",
  authDomain: "helios-iitbbs.firebaseapp.com",
  projectId: "helios-iitbbs",
  storageBucket: "helios-iitbbs.firebasestorage.app",
  messagingSenderId: "546678808686",
  appId: "1:546678808686:web:cac1c4d9d3cdd16e6c067f",
  measurementId: "G-H0M6VB0RVD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Setup reCAPTCHA
window.recaptchaVerifier = new RecaptchaVerifier(
  auth,
  "recaptcha-container",
  {
    size: "normal",
    callback: (response) => {
      console.log("reCAPTCHA solved");
    },
  }
);

// Send OTP
const phoneNumber = "+917396425771";

const appVerifier = window.recaptchaVerifier;

signInWithPhoneNumber(auth, phoneNumber, appVerifier)
  .then((confirmationResult) => {

    // SMS sent
    const code = prompt("Enter OTP");

    return confirmationResult.confirm(code);
  })
  .then((result) => {

    // User signed in
    console.log("User:", result.user);

    return result.user.getIdToken();
  })
  .then((token) => {
    console.log("Firebase Token:", token);
  })
  .catch((error) => {
    console.error(error);
  });