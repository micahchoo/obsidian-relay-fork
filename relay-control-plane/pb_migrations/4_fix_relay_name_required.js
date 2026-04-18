/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Make name field optional in relays collection
    const relays = Dao(db).findCollectionByNameOrId("relays")
    const nameField = relays.schema.getFieldByName("name")
    nameField.required = false
    Dao(db).saveCollection(relays)
}, (db) => {
    const relays = Dao(db).findCollectionByNameOrId("relays")
    const nameField = relays.schema.getFieldByName("name")
    nameField.required = true
    Dao(db).saveCollection(relays)
})