import express from "express";

// Public landing pages for links shared out of the app. Chat apps only make
// https:// links tappable, so a shared ride points here and this page hands
// off to the app (helios://ride/<id>). Deliberately reads nothing from the
// database: the link reveals no ride or student details to whoever opens it.

const router = express.Router();

const ANDROID_PACKAGE = "com.helios.iitbbs";

const page = (rideId) => {
    const appLink = `helios://ride/${rideId}`;
    // Android Chrome opens intent:// links reliably, even without an earlier tap
    const intentLink = `intent://ride/${rideId}#Intent;scheme=helios;package=${ANDROID_PACKAGE};end`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ride pool on Helios</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #FCF8F9; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #181925; }
  .card { max-width: 340px; margin: 24px; padding: 32px 24px; background: #fff; border: 1px solid #ECEBF0; border-radius: 24px; text-align: center; }
  .icon { width: 72px; height: 72px; margin: 0 auto 16px; border-radius: 36px; background: #E8E87D; display: flex; align-items: center; justify-content: center; font-size: 34px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 14px; color: #47464C; line-height: 1.5; margin: 0 0 24px; }
  a.button { display: block; padding: 14px; border-radius: 14px; background: #2D2E3A; color: #fff; font-weight: 700; text-decoration: none; }
  small { display: block; margin-top: 16px; color: #77767C; font-size: 12px; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">🚕</div>
  <h1>Someone shared a ride pool</h1>
  <p>Open it in the Helios app to see the route, seats and fare, and ask to join.</p>
  <a class="button" id="open" href="${appLink}">Open in Helios</a>
  <small>Don't have Helios? It's the IIT Bhubaneswar campus app - ask your batch for it.</small>
</div>
<script>
  var isAndroid = /android/i.test(navigator.userAgent);
  var link = isAndroid ? ${JSON.stringify(intentLink)} : ${JSON.stringify(appLink)};
  document.getElementById("open").href = link;
  window.location.href = link;
</script>
</body>
</html>`;
};

// GET /r/ride/:id
router.get("/ride/:id", (req, res) => {
    const rideId = Number(req.params.id);
    if (!Number.isInteger(rideId) || rideId <= 0) {
        return res.status(404).send("Ride link not found");
    }
    res.set("Cache-Control", "public, max-age=300").type("html").send(page(rideId));
});

export default router;
