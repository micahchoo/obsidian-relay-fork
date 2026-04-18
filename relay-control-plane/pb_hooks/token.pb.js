/// <reference path="../pb_data/types.d.ts" />

// POST /token
// Called by LiveTokenStore.ts for every document sync connection.
// Input:  { docId: string, relay: string, folder: string }
// Output: ClientToken { url, docId, folder, token, authorization, expiryTime }
routerAdd("POST", "/token", (c) => {
    console.log("[/token] ENTRY hook invoked")
    let info
    try {
        info = $apis.requestInfo(c)
    } catch (e) {
        console.log("[/token] ERR requestInfo threw:", e && e.message)
        return c.json(500, { error: "requestInfo failed", detail: String(e && e.message) })
    }
    if (!info.authRecord) {
        console.log("[/token] no authRecord — 401")
        return c.json(401, { error: "Unauthorized" })
    }

    const body = info.data || {}
    const docId   = body.docId
    const relayId = body.relay
    const folder  = body.folder
    console.log("[/token] parsed body docId=" + docId + " relayId=" + relayId + " folder=" + folder + " user=" + (info.authRecord && info.authRecord.id))

    if (!docId || !relayId || !folder) {
        console.log("[/token] missing fields — 400")
        return c.json(400, { error: "Missing required fields: docId, relay, folder" })
    }

    // Resolve relay server URL — look up provider via relay record.
    // Client sends the relay's `guid` field (UUID), NOT PocketBase's short `id`.
    // findRecordById uses `id` so we must use findFirstRecordByFilter on `guid`.
    let relay
    try {
        relay = $app.dao().findFirstRecordByFilter("relays", "guid = {:guid}", { guid: relayId })
        console.log("[/token] relay found id=" + relay.get("id") + " guid=" + relay.get("guid") + " provider=" + relay.get("provider"))
    } catch (err) {
        console.log("[/token] relay not found by guid: " + relayId + " err=" + (err && err.message))
        return c.json(404, { error: "Relay not found", relayId: relayId })
    }

    // Priority: RELAY_SERVER_URL env wins when set (docker-internal address reachable
    // from the PB container). Provider record's `url` is host-facing metadata —
    // often `http://localhost:<port>` which is unreachable from inside this container.
    // Only fall back to provider.url when env is empty.
    let serverUrl = $os.getenv("RELAY_SERVER_URL")
    if (!serverUrl) {
        try {
            const providerId = relay.get("provider")
            if (providerId) {
                const provider = $app.dao().findRecordById("providers", providerId)
                const provUrl = provider.get("url")
                if (provUrl) serverUrl = provUrl
            }
        } catch (err) {
            console.log("[/token] provider lookup failed for relayId=" + relayId + ":", err && err.message)
        }
    }
    console.log("[/token] serverUrl=" + serverUrl)

    if (!serverUrl) {
        return c.json(503, { error: "No relay server configured" })
    }

    const serverAuth = $os.getenv("RELAY_SERVER_AUTH")
    if (!serverAuth) {
        return c.json(503, { error: "Relay server auth not configured" })
    }

    const authHeaders = {
        "Authorization": "Bearer " + serverAuth,
        "Content-Type": "application/json",
    }
    const authBody = JSON.stringify({ authorization: "full" })

    // First attempt
    let resp
    try {
        resp = $http.send({
            url: serverUrl + "/doc/" + docId + "/auth",
            method: "POST",
            headers: authHeaders,
            body: authBody,
            timeout: 10,
        })
        console.log("[/token] first /doc/:id/auth status=" + resp.statusCode)
    } catch (e) {
        console.log("[/token] ERR $http.send threw on auth:", e && e.message)
        return c.json(502, { error: "relay-server unreachable", detail: String(e && e.message) })
    }

    // If doc doesn't exist yet, create it then retry
    if (resp.statusCode === 404) {
        console.log("[/token] doc not found — creating")
        let createResp
        try {
            createResp = $http.send({
                url: serverUrl + "/doc/new",
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ docId: docId }),
                timeout: 10,
            })
        } catch (e) {
            console.log("[/token] ERR $http.send threw on /doc/new:", e && e.message)
            return c.json(502, { error: "relay-server unreachable (create)", detail: String(e && e.message) })
        }
        if (createResp.statusCode !== 200) {
            console.log("[/token] create failed status=" + createResp.statusCode + " body=" + createResp.raw)
            return c.json(502, { error: "Failed to create document on relay server", status: createResp.statusCode })
        }
        // Retry auth after creation
        try {
            resp = $http.send({
                url: serverUrl + "/doc/" + docId + "/auth",
                method: "POST",
                headers: authHeaders,
                body: authBody,
                timeout: 10,
            })
            console.log("[/token] retry /doc/:id/auth status=" + resp.statusCode)
        } catch (e) {
            console.log("[/token] ERR $http.send threw on retry auth:", e && e.message)
            return c.json(502, { error: "relay-server unreachable (retry)", detail: String(e && e.message) })
        }
    }

    if (resp.statusCode !== 200) {
        console.log("[/token] relay-server auth non-200 status=" + resp.statusCode + " body=" + resp.raw)
        return c.json(502, { error: "Relay server error", status: resp.statusCode, body: resp.raw })
    }

    // Relay server returns ClientToken — append folder (not included by relay-server)
    let clientToken
    try {
        clientToken = JSON.parse(resp.raw)
    } catch (e) {
        console.log("[/token] ERR JSON.parse failed:", e && e.message, "raw=", resp.raw)
        return c.json(502, { error: "invalid response from relay-server" })
    }
    clientToken.folder = folder
    console.log("[/token] SUCCESS docId=" + docId + " url=" + clientToken.url)

    return c.json(200, clientToken)
}, $apis.requireRecordAuth())
