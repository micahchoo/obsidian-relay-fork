/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Fix users collection for proper password authentication
    const users = Dao(db).findCollectionByNameOrId("users")
    
    // Enable password-based login
    users.loginRule = ""
    users.createRule = ""
    users.listRule = "@request.auth.id != ''"
    users.viewRule = "@request.auth.id = id"
    users.updateRule = "@request.auth.id = id"
    users.deleteRule = null
    
    // Enable email auth in options
    users.options = {
        allowOAuth2Auth:    true,
        allowEmailAuth:     true,
        allowUsernameAuth:  false,
        requireEmail:       true,
    }
    
    Dao(db).saveCollection(users)
}, (db) => {
    // Revert to default
    const users = Dao(db).findCollectionByNameOrId("users")
    users.loginRule = null
    users.createRule = null
    users.options = {
        allowOAuth2Auth:    true,
        allowEmailAuth:     false,
        allowUsernameAuth:  false,
        requireEmail:       true,
    }
    Dao(db).saveCollection(users)
})