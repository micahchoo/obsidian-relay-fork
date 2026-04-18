/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Enable password authentication by setting loginRule to "" (public)
    const users = Dao(db).findCollectionByNameOrId("users")
    users.loginRule = ""
    Dao(db).saveCollection(users)
}, (db) => {
    // Revert to disabled password auth
    const users = Dao(db).findCollectionByNameOrId("users")
    users.loginRule = null
    Dao(db).saveCollection(users)
})