/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Allow OAuth2 registration for guests
    const users = Dao(db).findCollectionByNameOrId("users")
    users.createRule = ""
    Dao(db).saveCollection(users)

    // Allow guests to poll the code_exchange record during OAuth2 login
    const codeExchange = Dao(db).findCollectionByNameOrId("code_exchange")
    codeExchange.viewRule = ""
    Dao(db).saveCollection(codeExchange)
}, (db) => {
    const users = Dao(db).findCollectionByNameOrId("users")
    users.createRule = null
    Dao(db).saveCollection(users)

    const codeExchange = Dao(db).findCollectionByNameOrId("code_exchange")
    codeExchange.viewRule = null
    Dao(db).saveCollection(codeExchange)
})
