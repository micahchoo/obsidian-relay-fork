/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Enable email/password authentication in users collection
    const users = Dao(db).findCollectionByNameOrId("users")
    users.options = {
        allowOAuth2Auth:    true,
        allowEmailAuth:     true,   // Enable password-based login
        allowUsernameAuth:  false,
        requireEmail:       true,
    }
    users.loginRule = ""  // Allow public login
    Dao(db).saveCollection(users)
}, (db) => {
    // Revert
    const users = Dao(db).findCollectionByNameOrId("users")
    users.options = {
        allowOAuth2Auth:    true,
        allowEmailAuth:     false,
        allowUsernameAuth:  false,
        requireEmail:       true,
    }
    users.loginRule = null
    Dao(db).saveCollection(users)
})