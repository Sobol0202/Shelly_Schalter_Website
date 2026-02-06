exports.handler = async (event) => {
  // ---------- CORS ----------
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Use POST" };
  }

  // ---------- ENV VARS ----------
  const HOST = process.env.SHELLY_HOST;          // z.B. shelly-106-eu.shelly.cloud
  const AUTH_KEY = process.env.SHELLY_AUTH_KEY;  // Cloud Authorization Key
  const DEVICE_ID = process.env.SHELLY_DEVICE_ID;
  const CHANNEL = Number(process.env.SHELLY_CHANNEL ?? "0");

  if (!HOST || !AUTH_KEY || !DEVICE_ID) {
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: "Missing env vars",
        need: ["SHELLY_HOST", "SHELLY_AUTH_KEY", "SHELLY_DEVICE_ID"],
      }),
    };
  }

  const apiBase = `https://${HOST}`;

  // ---------- CONNECTIVITY PROBE ----------
  try {
    await fetch(apiBase, { method: "GET" });
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        step: "probe",
        apiBase,
        error: String(e),
      }),
    };
  }

  // ---------- 1) STATUS HOLEN ----------
  let statusData;
  try {
    const getRes = await fetch(
      `${apiBase}/v2/devices/api/get?auth_key=${encodeURIComponent(AUTH_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [DEVICE_ID],
          select: ["status"],
        }),
      }
    );

    if (!getRes.ok) {
      const text = await getRes.text();
      throw new Error(`GET failed (${getRes.status}): ${text}`);
    }

    const arr = await getRes.json();
    statusData = arr?.[0]?.status ?? {};
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        step: "get",
        error: String(e),
      }),
    };
  }

  // ---------- STATUS PARSEN (Plus 1PM) ----------
  const switchKey = `switch:${CHANNEL}`;
  const current = statusData?.[switchKey]?.output;

  if (typeof current !== "boolean") {
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: `Cannot read status["${switchKey}"].output`,
        statusKeys: Object.keys(statusData),
      }),
    };
  }

  const nextOn = !current;

  // ---------- 2) SCHALTEN ----------
  try {
    const setRes = await fetch(
      `${apiBase}/v2/devices/api/set/switch?auth_key=${encodeURIComponent(AUTH_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: DEVICE_ID,
          channel: CHANNEL,
          on: nextOn,
        }),
      }
    );

    if (!setRes.ok) {
      const text = await setRes.text();
      throw new Error(`SET failed (${setRes.status}): ${text}`);
    }

    const result = await setRes.json().catch(() => ({}));

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        from: current,
        to: nextOn,
        result,
      }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        step: "set",
        error: String(e),
      }),
    };
  }
};
