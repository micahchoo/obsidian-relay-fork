/// <reference path="../pb_data/types.d.ts" />

// POST /file-token
// Called by LiveTokenStore.fetchFileToken for binary file/attachment sync.
// Input:  { docId, relay, folder, hash, contentType, contentLength }
// Output: FileToken (ClientToken extended with file metadata)
routerAdd("POST", "/file-token", (c) => {
    const info = $apis.requestInfo(c)
    if (!info.authRecord) {
        return c.json(401, { error: "Unauthorized" })
    }

    const body = info.data
    const docId         = body.docId
    const relayId       = body.relay
    const folder        = body.folder
    const fileHash      = body.hash
    const contentType   = body.contentType
    const contentLength = body.contentLength

    if (!docId || !relayId || !folder) {
        return c.json(400, { error: "Missing required fields: docId, relay, folder" })
    }

    // Resolve server URL
    let serverUrl = $os.getenv("RELAY_SERVER_URL")
    try {
        const relay = $app.dao().findRecordById("relays", relayId)
        const providerId = relay.get("provider")
        if (providerId) {
            const provider = $app.dao().findRecordById("providers", providerId)
            const provUrl = provider.get("url")
            if (provUrl) serverUrl = provUrl
        }
    } catch (err) {
        console.log("[/file-token] relay lookup failed for relayId=" + relayId + ", using env fallback:", err.message)
    }

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

    // For files, request write authorization when hash is provided (upload), read-only otherwise
    const authorization = fileHash ? "full" : "read-only"

    let resp = $http.send({
        url: serverUrl + "/doc/" + docId + "/auth",
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ authorization }),
        timeout: 10,
    })

    if (resp.statusCode === 404) {
        $http.send({
            url: serverUrl + "/doc/new",
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ docId }),
            timeout: 10,
        })
        resp = $http.send({
            url: serverUrl + "/doc/" + docId + "/auth",
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ authorization }),
            timeout: 10,
        })
    }

    if (resp.statusCode !== 200) {
        return c.json(502, { error: "Relay server error", status: resp.statusCode })
    }

    const fileToken = JSON.parse(resp.raw)
    fileToken.folder        = folder
    fileToken.fileHash      = fileHash      || null
    fileToken.contentType   = contentType   || null
    fileToken.contentLength = contentLength || null
    fileToken.authorization = authorization

    return c.json(200, fileToken)
}, $apis.requireRecordAuth())
