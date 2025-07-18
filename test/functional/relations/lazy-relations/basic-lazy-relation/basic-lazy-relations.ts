import "reflect-metadata"
import {
    closeTestingConnections,
    createTestingConnections,
    reloadTestingDatabases,
} from "../../../../utils/test-utils"
import { DataSource } from "../../../../../src/data-source/DataSource"
import { Post } from "./entity/Post"
import { Category } from "./entity/Category"
import { EntitySchema } from "../../../../../src"

/**
 * Because lazy relations are overriding prototype is impossible to run these tests on multiple connections.
 * So we run tests only for mysql.
 */
describe("basic-lazy-relations", () => {
    const appRoot = require("app-root-path")
    const resourceDir =
        appRoot +
        "/test/functional/relations/lazy-relations/basic-lazy-relation/"
    const UserSchema = new EntitySchema(
        require(resourceDir + "schema/user.json"),
    )
    const ProfileSchema = new EntitySchema(
        require(resourceDir + "schema/profile.json"),
    )

    let connections: DataSource[]
    before(
        async () =>
            (connections = await createTestingConnections({
                entities: [Post, Category, UserSchema, ProfileSchema],
                enabledDrivers: ["postgres"], // we can properly test lazy-relations only on one platform
            })),
    )
    beforeEach(() => reloadTestingDatabases(connections))
    after(() => closeTestingConnections(connections))

    it("should persist and hydrate successfully on a relation without inverse side", () =>
        Promise.all(
            connections.map(async (connection) => {
                const postRepository = connection.getRepository(Post)
                const categoryRepository = connection.getRepository(Category)

                const savedCategory1 = new Category()
                savedCategory1.name = "kids"
                const savedCategory2 = new Category()
                savedCategory2.name = "people"
                const savedCategory3 = new Category()
                savedCategory3.name = "animals"

                await categoryRepository.save(savedCategory1)
                await categoryRepository.save(savedCategory2)
                await categoryRepository.save(savedCategory3)

                const savedPost = new Post()
                savedPost.title = "Hello post"
                savedPost.text = "This is post about post"
                savedPost.categories = Promise.resolve([
                    savedCategory1,
                    savedCategory2,
                    savedCategory3,
                ])

                await postRepository.save(savedPost)

                await savedPost.categories.should.eventually.be.eql([
                    savedCategory1,
                    savedCategory2,
                    savedCategory3,
                ])

                const post = (await postRepository.findOneBy({ id: 1 }))!
                post.title.should.be.equal("Hello post")
                post.text.should.be.equal("This is post about post")

                const categories = await post.categories
                categories.length.should.be.equal(3)
                categories.should.deep.include({ id: 1, name: "kids" })
                categories.should.deep.include({ id: 2, name: "people" })
                categories.should.deep.include({ id: 3, name: "animals" })
            }),
        ))

    it("should persist and hydrate successfully on a relation with inverse side", () =>
        Promise.all(
            connections.map(async (connection) => {
                const postRepository = connection.getRepository(Post)
                const categoryRepository = connection.getRepository(Category)

                const savedCategory1 = new Category()
                savedCategory1.name = "kids"
                const savedCategory2 = new Category()
                savedCategory2.name = "people"
                const savedCategory3 = new Category()
                savedCategory3.name = "animals"

                await categoryRepository.save(savedCategory1)
                await categoryRepository.save(savedCategory2)
                await categoryRepository.save(savedCategory3)

                const savedPost = new Post()
                savedPost.title = "Hello post"
                savedPost.text = "This is post about post"
                savedPost.twoSideCategories = Promise.resolve([
                    savedCategory1,
                    savedCategory2,
                    savedCategory3,
                ])

                await postRepository.save(savedPost)

                await savedPost.twoSideCategories.should.eventually.be.eql([
                    savedCategory1,
                    savedCategory2,
                    savedCategory3,
                ])

                const post = (await postRepository.findOneBy({ id: 1 }))!
                post.title.should.be.equal("Hello post")
                post.text.should.be.equal("This is post about post")

                const categories = await post.twoSideCategories
                categories.length.should.be.equal(3)
                categories.should.deep.include({ id: 1, name: "kids" })
                categories.should.deep.include({ id: 2, name: "people" })
                categories.should.deep.include({ id: 3, name: "animals" })

                const category = (await categoryRepository.findOneBy({
                    id: 1,
                }))!
                category.name.should.be.equal("kids")

                const twoSidePosts = await category.twoSidePosts

                const likePost = new Post()
                likePost.id = 1
                likePost.title = "Hello post"
                likePost.text = "This is post about post"
                twoSidePosts.should.deep.include(likePost)
            }),
        ))

    it("should persist and hydrate successfully on a one-to-one relation with inverse side loaded from entity schema", () =>
        Promise.all(
            connections.map(async (connection) => {
                const userRepository = connection.getRepository("User")
                const profileRepository = connection.getRepository("Profile")

                const profile: any = profileRepository.create()
                profile.country = "Japan"
                await profileRepository.save(profile)

                const newUser: any = userRepository.create()
                newUser.firstName = "Umed"
                newUser.secondName = "San"
                newUser.profile = Promise.resolve(profile)
                await userRepository.save(newUser)

                await newUser.profile.should.eventually.be.eql(profile)

                // const loadOptions: FindOptions = { alias: "user", innerJoinAndSelect };
                const loadedUser: any = await userRepository.findOneBy({
                    id: 1,
                })
                loadedUser.firstName.should.be.equal("Umed")
                loadedUser.secondName.should.be.equal("San")

                const lazyLoadedProfile = await loadedUser.profile
                lazyLoadedProfile.country.should.be.equal("Japan")
            }),
        ))

    it("should persist and hydrate successfully on a many-to-one relation without inverse side", () =>
        Promise.all(
            connections.map(async (connection) => {
                // create some fake posts and categories to make sure that there are several post ids in the db
                const fakePosts: Post[] = []
                for (let i = 0; i < 30; i++) {
                    const fakePost = new Post()
                    fakePost.title = "post #" + i
                    fakePost.text = "post #" + i
                    fakePosts.push(fakePost)
                }
                await connection.manager.save(fakePosts)

                const fakeCategories: Category[] = []
                for (let i = 0; i < 8; i++) {
                    const fakeCategory = new Category()
                    fakeCategory.name = "category #" + i
                    fakeCategories.push(fakeCategory)
                }
                await connection.manager.save(fakeCategories)

                const category = new Category()
                category.name = "category of great post"

                const post = new Post()
                post.title = "post with great category"
                post.text = "post with great category and great text"
                post.category = Promise.resolve(category)

                await connection.manager.save(category)
                await connection.manager.save(post)

                const loadedPost = await connection.manager.findOne(Post, {
                    where: { title: "post with great category" },
                })
                const loadedCategory = await loadedPost!.category

                loadedCategory.name.should.be.equal("category of great post")
            }),
        ))

    it("should persist and hydrate successfully on a many-to-one relation with inverse side", () =>
        Promise.all(
            connections.map(async (connection) => {
                // create some fake posts and categories to make sure that there are several post ids in the db
                const fakePosts: Post[] = []
                for (let i = 0; i < 8; i++) {
                    const fakePost = new Post()
                    fakePost.title = "post #" + i
                    fakePost.text = "post #" + i
                    fakePosts.push(fakePost)
                }
                await connection.manager.save(fakePosts)

                const fakeCategories: Category[] = []
                for (let i = 0; i < 30; i++) {
                    const fakeCategory = new Category()
                    fakeCategory.name = "category #" + i
                    fakeCategories.push(fakeCategory)
                }
                await connection.manager.save(fakeCategories)

                const category = new Category()
                category.name = "category of great post"

                const post = new Post()
                post.title = "post with great category"
                post.text = "post with great category and great text"
                post.twoSideCategory = Promise.resolve(category)

                await connection.manager.save(category)
                await connection.manager.save(post)

                const loadedPost = await connection.manager.findOne(Post, {
                    where: { title: "post with great category" },
                })
                const loadedCategory = await loadedPost!.twoSideCategory

                loadedCategory.name.should.be.equal("category of great post")
            }),
        ))

    it("should persist and hydrate successfully on a one-to-many relation", () =>
        Promise.all(
            connections.map(async (connection) => {
                // create some fake posts and categories to make sure that there are several post ids in the db
                const fakePosts: Post[] = []
                for (let i = 0; i < 8; i++) {
                    const fakePost = new Post()
                    fakePost.title = "post #" + i
                    fakePost.text = "post #" + i
                    fakePosts.push(fakePost)
                }
                await connection.manager.save(fakePosts)

                const fakeCategories: Category[] = []
                for (let i = 0; i < 30; i++) {
                    const fakeCategory = new Category()
                    fakeCategory.name = "category #" + i
                    fakeCategories.push(fakeCategory)
                }
                await connection.manager.save(fakeCategories)

                const category = new Category()
                category.name = "category of great post"
                await connection.manager.save(category)

                const post = new Post()
                post.title = "post with great category"
                post.text = "post with great category and great text"
                post.twoSideCategory = Promise.resolve(category)
                await connection.manager.save(post)

                const loadedCategory = await connection.manager.findOne(
                    Category,
                    { where: { name: "category of great post" } },
                )
                const loadedPost = await loadedCategory!.twoSidePosts2

                loadedPost[0].title.should.be.equal("post with great category")
            }),
        ))

    it("should persist and hydrate successfully on a one-to-one relation owner side", () =>
        Promise.all(
            connections.map(async (connection) => {
                // create some fake posts and categories to make sure that there are several post ids in the db
                const fakePosts: Post[] = []
                for (let i = 0; i < 8; i++) {
                    const fakePost = new Post()
                    fakePost.title = "post #" + i
                    fakePost.text = "post #" + i
                    fakePosts.push(fakePost)
                }
                await connection.manager.save(fakePosts)

                const fakeCategories: Category[] = []
                for (let i = 0; i < 30; i++) {
                    const fakeCategory = new Category()
                    fakeCategory.name = "category #" + i
                    fakeCategories.push(fakeCategory)
                }
                await connection.manager.save(fakeCategories)

                const category = new Category()
                category.name = "category of great post"
                await connection.manager.save(category)

                const post = new Post()
                post.title = "post with great category"
                post.text = "post with great category and great text"
                post.oneCategory = Promise.resolve(category)
                await connection.manager.save(post)

                const loadedPost = await connection.manager.findOne(Post, {
                    where: { title: "post with great category" },
                })
                const loadedCategory = await loadedPost!.oneCategory

                loadedCategory.name.should.be.equal("category of great post")
            }),
        ))

    it("should persist and hydrate successfully on a one-to-one relation inverse side", () =>
        Promise.all(
            connections.map(async (connection) => {
                // create some fake posts and categories to make sure that there are several post ids in the db
                const fakePosts: Post[] = []
                for (let i = 0; i < 8; i++) {
                    const fakePost = new Post()
                    fakePost.title = "post #" + i
                    fakePost.text = "post #" + i
                    fakePosts.push(fakePost)
                }
                await connection.manager.save(fakePosts)

                const fakeCategories: Category[] = []
                for (let i = 0; i < 30; i++) {
                    const fakeCategory = new Category()
                    fakeCategory.name = "category #" + i
                    fakeCategories.push(fakeCategory)
                }
                await connection.manager.save(fakeCategories)

                const category = new Category()
                category.name = "category of great post"
                await connection.manager.save(category)

                const post = new Post()
                post.title = "post with great category"
                post.text = "post with great category and great text"
                post.oneCategory = Promise.resolve(category)
                await connection.manager.save(post)

                const loadedCategory = await connection.manager.findOne(
                    Category,
                    { where: { name: "category of great post" } },
                )
                const loadedPost = await loadedCategory!.onePost
                loadedPost.title.should.be.equal("post with great category")
            }),
        ))

    it("should successfully load relations within a transaction", () =>
        Promise.all(
            connections
                .filter((connection) =>
                    new Set([
                        "mysql",
                        "sqlite",
                        "better-sqlite3",
                        "postgres",
                    ]).has(connection.options.type),
                )
                .map(async (connection) => {
                    await connection.manager.transaction(async (manager) => {
                        const category = new Category()
                        category.name = "category of great post"
                        await manager.save(category)

                        const post = new Post()
                        post.title = "post with great category"
                        post.text = "post with great category and great text"
                        post.oneCategory = Promise.resolve(category)
                        await manager.save(post)

                        const loadedCategory = await manager.findOne(Category, {
                            where: { name: "category of great post" },
                        })
                        const loadedPost = await loadedCategory!.onePost
                        loadedPost.title.should.be.equal(
                            "post with great category",
                        )
                    })
                }),
        ))

    it("should successfully load relations outside a transaction with entity generated within a transaction", () =>
        Promise.all(
            connections
                .filter((connection) =>
                    new Set([
                        "mysql",
                        "sqlite",
                        "better-sqlite3",
                        "postgres",
                    ]).has(connection.options.type),
                )
                .map(async (connection) => {
                    const loadedCategory = await connection.manager.transaction(
                        async (manager) => {
                            const category = new Category()
                            category.name = "category of great post"
                            await manager.save(category)

                            const post = new Post()
                            post.title = "post with great category"
                            post.text =
                                "post with great category and great text"
                            post.oneCategory = Promise.resolve(category)
                            await manager.save(post)

                            return await manager.findOne(Category, {
                                where: { name: "category of great post" },
                            })
                        },
                    )
                    const loadedPost = await loadedCategory!.onePost
                    loadedPost.title.should.be.equal("post with great category")
                }),
        ))
})
