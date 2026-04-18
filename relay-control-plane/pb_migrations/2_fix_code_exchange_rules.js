/// <reference path="../pb_data/types.d.ts" />

// code_exchange must be publicly readable — the plugin polls it before the user
// is authenticated (it's how the OAuth2 code gets passed back to the plugin).
migrate((db) => {
    const col = Dao(db).findCollectionByNameOrId("code_exchange")
    col.viewRule = ""   // empty string = anyone can read, including unauthenticated
    Dao(db).saveCollection(col)
}, (db) => {
    const col = Dao(db).findCollectionByNameOrId("code_exchange")
    col.viewRule = null
    Dao(db).saveCollection(col)
})
