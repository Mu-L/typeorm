import { Driver } from "../Driver"
import { ConnectionIsNotSetError } from "../../error/ConnectionIsNotSetError"
import { DriverPackageNotInstalledError } from "../../error/DriverPackageNotInstalledError"
import { DriverUtils } from "../DriverUtils"
import { CteCapabilities } from "../types/CteCapabilities"
import { SqlServerQueryRunner } from "./SqlServerQueryRunner"
import { ObjectLiteral } from "../../common/ObjectLiteral"
import { ColumnMetadata } from "../../metadata/ColumnMetadata"
import { DateUtils } from "../../util/DateUtils"
import { PlatformTools } from "../../platform/PlatformTools"
import { DataSource } from "../../data-source/DataSource"
import { RdbmsSchemaBuilder } from "../../schema-builder/RdbmsSchemaBuilder"
import { SqlServerConnectionOptions } from "./SqlServerConnectionOptions"
import { MappedColumnTypes } from "../types/MappedColumnTypes"
import { ColumnType } from "../types/ColumnTypes"
import { DataTypeDefaults } from "../types/DataTypeDefaults"
import { MssqlParameter } from "./MssqlParameter"
import { TableColumn } from "../../schema-builder/table/TableColumn"
import { SqlServerConnectionCredentialsOptions } from "./SqlServerConnectionCredentialsOptions"
import { EntityMetadata } from "../../metadata/EntityMetadata"
import { OrmUtils } from "../../util/OrmUtils"
import { ApplyValueTransformers } from "../../util/ApplyValueTransformers"
import { ReplicationMode } from "../types/ReplicationMode"
import { Table } from "../../schema-builder/table/Table"
import { View } from "../../schema-builder/view/View"
import { TableForeignKey } from "../../schema-builder/table/TableForeignKey"
import { TypeORMError } from "../../error"
import { InstanceChecker } from "../../util/InstanceChecker"
import { UpsertType } from "../types/UpsertType"
import { FindOperator } from "../../find-options/FindOperator"

/**
 * Organizes communication with SQL Server DBMS.
 */
export class SqlServerDriver implements Driver {
    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------

    /**
     * Connection used by driver.
     */
    connection: DataSource

    /**
     * SQL Server library.
     */
    mssql: any

    /**
     * Pool for master database.
     */
    master: any

    /**
     * Pool for slave databases.
     * Used in replication.
     */
    slaves: any[] = []

    // -------------------------------------------------------------------------
    // Public Implemented Properties
    // -------------------------------------------------------------------------

    /**
     * Connection options.
     */
    options: SqlServerConnectionOptions

    /**
     * Database name used to perform all write queries.
     */
    database?: string

    /**
     * Schema name used to perform all write queries.
     */
    schema?: string

    /**
     * Schema that's used internally by SQL Server for object resolution.
     *
     * Because we never set this we have to track it in separately from the `schema` so
     * we know when we have to specify the full schema or not.
     *
     * In most cases this will be `dbo`.
     */
    searchSchema?: string

    /**
     * Indicates if replication is enabled.
     */
    isReplicated: boolean = false

    /**
     * Indicates if tree tables are supported by this driver.
     */
    treeSupport = true

    /**
     * Represent transaction support by this driver
     */
    transactionSupport = "simple" as const

    /**
     * Gets list of supported column data types by a driver.
     *
     * @see https://docs.microsoft.com/en-us/sql/t-sql/data-types/data-types-transact-sql
     */
    supportedDataTypes: ColumnType[] = [
        "int",
        "bigint",
        "bit",
        "decimal",
        "money",
        "numeric",
        "smallint",
        "smallmoney",
        "tinyint",
        "float",
        "real",
        "date",
        "datetime2",
        "datetime",
        "datetimeoffset",
        "smalldatetime",
        "time",
        "char",
        "varchar",
        "text",
        "nchar",
        "nvarchar",
        "ntext",
        "binary",
        "image",
        "varbinary",
        "hierarchyid",
        "sql_variant",
        "timestamp",
        "uniqueidentifier",
        "xml",
        "geometry",
        "geography",
        "rowversion",
    ]

    /**
     * Returns type of upsert supported by driver if any
     */
    supportedUpsertTypes: UpsertType[] = ["merge-into"]

    /**
     * Gets list of spatial column data types.
     */
    spatialTypes: ColumnType[] = ["geometry", "geography"]

    /**
     * Gets list of column data types that support length by a driver.
     */
    withLengthColumnTypes: ColumnType[] = [
        "char",
        "varchar",
        "nchar",
        "nvarchar",
        "binary",
        "varbinary",
    ]

    /**
     * Gets list of column data types that support precision by a driver.
     */
    withPrecisionColumnTypes: ColumnType[] = [
        "decimal",
        "numeric",
        "time",
        "datetime2",
        "datetimeoffset",
    ]

    /**
     * Gets list of column data types that support scale by a driver.
     */
    withScaleColumnTypes: ColumnType[] = ["decimal", "numeric"]

    /**
     * Orm has special columns and we need to know what database column types should be for those types.
     * Column types are driver dependant.
     */
    mappedDataTypes: MappedColumnTypes = {
        createDate: "datetime2",
        createDateDefault: "getdate()",
        updateDate: "datetime2",
        updateDateDefault: "getdate()",
        deleteDate: "datetime2",
        deleteDateNullable: true,
        version: "int",
        treeLevel: "int",
        migrationId: "int",
        migrationName: "varchar",
        migrationTimestamp: "bigint",
        cacheId: "int",
        cacheIdentifier: "nvarchar",
        cacheTime: "bigint",
        cacheDuration: "int",
        cacheQuery: "nvarchar(MAX)" as any,
        cacheResult: "nvarchar(MAX)" as any,
        metadataType: "varchar",
        metadataDatabase: "varchar",
        metadataSchema: "varchar",
        metadataTable: "varchar",
        metadataName: "varchar",
        metadataValue: "nvarchar(MAX)" as any,
    }

    /**
     * The prefix used for the parameters
     */
    parametersPrefix: string = "@"

    /**
     * Default values of length, precision and scale depends on column data type.
     * Used in the cases when length/precision/scale is not specified by user.
     */
    dataTypeDefaults: DataTypeDefaults = {
        char: { length: 1 },
        nchar: { length: 1 },
        varchar: { length: 255 },
        nvarchar: { length: 255 },
        binary: { length: 1 },
        varbinary: { length: 1 },
        decimal: { precision: 18, scale: 0 },
        numeric: { precision: 18, scale: 0 },
        time: { precision: 7 },
        datetime2: { precision: 7 },
        datetimeoffset: { precision: 7 },
    }

    cteCapabilities: CteCapabilities = {
        enabled: true,
        // todo: enable it for SQL Server - it's partially supported, but there are issues with generation of non-standard OUTPUT clause
        writable: false,
    }

    /**
     * Max length allowed by MSSQL Server for aliases (identifiers).
     * @see https://docs.microsoft.com/en-us/sql/sql-server/maximum-capacity-specifications-for-sql-server
     */
    maxAliasLength = 128

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(connection: DataSource) {
        this.connection = connection
        this.options = connection.options as SqlServerConnectionOptions
        this.isReplicated = this.options.replication ? true : false

        // load mssql package
        this.loadDependencies()

        this.database = DriverUtils.buildDriverOptions(
            this.options.replication
                ? this.options.replication.master
                : this.options,
        ).database
        this.schema = DriverUtils.buildDriverOptions(this.options).schema

        // Object.assign(connection.options, DriverUtils.buildDriverOptions(connection.options)); // todo: do it better way
        // validate options to make sure everything is set
        // if (!this.options.host)
        // throw new DriverOptionNotSetError("host");
        // if (!this.options.username)
        //     throw new DriverOptionNotSetError("username");
        // if (!this.options.database)
        //     throw new DriverOptionNotSetError("database");
    }

    // -------------------------------------------------------------------------
    // Public Implemented Methods
    // -------------------------------------------------------------------------

    /**
     * Performs connection to the database.
     * Based on pooling options, it can either create connection immediately,
     * either create a pool and create connection when needed.
     */
    async connect(): Promise<void> {
        if (this.options.replication) {
            this.slaves = await Promise.all(
                this.options.replication.slaves.map((slave) => {
                    return this.createPool(this.options, slave)
                }),
            )
            this.master = await this.createPool(
                this.options,
                this.options.replication.master,
            )
        } else {
            this.master = await this.createPool(this.options, this.options)
        }

        if (!this.database || !this.searchSchema) {
            const queryRunner = this.createQueryRunner("master")

            if (!this.database) {
                this.database = await queryRunner.getCurrentDatabase()
            }

            if (!this.searchSchema) {
                this.searchSchema = await queryRunner.getCurrentSchema()
            }

            await queryRunner.release()
        }

        if (!this.schema) {
            this.schema = this.searchSchema
        }
    }

    /**
     * Makes any action after connection (e.g. create extensions in Postgres driver).
     */
    afterConnect(): Promise<void> {
        return Promise.resolve()
    }

    /**
     * Closes connection with the database.
     */
    async disconnect(): Promise<void> {
        if (!this.master) {
            throw new ConnectionIsNotSetError("mssql")
        }
        await this.closePool(this.master)
        await Promise.all(this.slaves.map((slave) => this.closePool(slave)))
        this.master = undefined
        this.slaves = []
    }

    /**
     * Closes connection pool.
     */
    protected async closePool(pool: any): Promise<void> {
        return new Promise<void>((ok, fail) => {
            pool.close((err: any) => (err ? fail(err) : ok()))
        })
    }

    /**
     * Creates a schema builder used to build and sync a schema.
     */
    createSchemaBuilder() {
        return new RdbmsSchemaBuilder(this.connection)
    }

    /**
     * Creates a query runner used to execute database queries.
     */
    createQueryRunner(mode: ReplicationMode) {
        return new SqlServerQueryRunner(this, mode)
    }

    /**
     * Replaces parameters in the given sql with special escaping character
     * and an array of parameter names to be passed to a query.
     */
    escapeQueryWithParameters(
        sql: string,
        parameters: ObjectLiteral,
        nativeParameters: ObjectLiteral,
    ): [string, any[]] {
        const escapedParameters: any[] = Object.keys(nativeParameters).map(
            (key) => nativeParameters[key],
        )
        if (!parameters || !Object.keys(parameters).length)
            return [sql, escapedParameters]

        const parameterIndexMap = new Map<string, number>()
        sql = sql.replace(
            /:(\.\.\.)?([A-Za-z0-9_.]+)/g,
            (full, isArray: string, key: string): string => {
                if (!parameters.hasOwnProperty(key)) {
                    return full
                }

                if (parameterIndexMap.has(key)) {
                    return this.parametersPrefix + parameterIndexMap.get(key)
                }

                const value: any = parameters[key]

                if (isArray) {
                    return value
                        .map((v: any) => {
                            escapedParameters.push(v)
                            return this.createParameter(
                                key,
                                escapedParameters.length - 1,
                            )
                        })
                        .join(", ")
                }

                if (typeof value === "function") {
                    return value()
                }

                escapedParameters.push(value)
                parameterIndexMap.set(key, escapedParameters.length - 1)
                return this.createParameter(key, escapedParameters.length - 1)
            },
        ) // todo: make replace only in value statements, otherwise problems
        return [sql, escapedParameters]
    }

    /**
     * Escapes a column name.
     */
    escape(columnName: string): string {
        return `"${columnName}"`
    }

    /**
     * Build full table name with database name, schema name and table name.
     * E.g. myDB.mySchema.myTable
     */
    buildTableName(
        tableName: string,
        schema?: string,
        database?: string,
    ): string {
        const tablePath = [tableName]

        if (schema) {
            tablePath.unshift(schema)
        }

        if (database) {
            if (!schema) {
                tablePath.unshift("")
            }

            tablePath.unshift(database)
        }

        return tablePath.join(".")
    }

    /**
     * Parse a target table name or other types and return a normalized table definition.
     */
    parseTableName(
        target: EntityMetadata | Table | View | TableForeignKey | string,
    ): { database?: string; schema?: string; tableName: string } {
        const driverDatabase = this.database
        const driverSchema = this.schema

        if (InstanceChecker.isTable(target) || InstanceChecker.isView(target)) {
            const parsed = this.parseTableName(target.name)

            return {
                database: target.database || parsed.database || driverDatabase,
                schema: target.schema || parsed.schema || driverSchema,
                tableName: parsed.tableName,
            }
        }

        if (InstanceChecker.isTableForeignKey(target)) {
            const parsed = this.parseTableName(target.referencedTableName)

            return {
                database:
                    target.referencedDatabase ||
                    parsed.database ||
                    driverDatabase,
                schema:
                    target.referencedSchema || parsed.schema || driverSchema,
                tableName: parsed.tableName,
            }
        }

        if (InstanceChecker.isEntityMetadata(target)) {
            // EntityMetadata tableName is never a path

            return {
                database: target.database || driverDatabase,
                schema: target.schema || driverSchema,
                tableName: target.tableName,
            }
        }

        const parts = target.split(".")

        if (parts.length === 3) {
            return {
                database: parts[0] || driverDatabase,
                schema: parts[1] || driverSchema,
                tableName: parts[2],
            }
        } else if (parts.length === 2) {
            return {
                database: driverDatabase,
                schema: parts[0],
                tableName: parts[1],
            }
        } else {
            return {
                database: driverDatabase,
                schema: driverSchema,
                tableName: target,
            }
        }
    }

    /**
     * Prepares given value to a value to be persisted, based on its column type and metadata.
     */
    preparePersistentValue(value: any, columnMetadata: ColumnMetadata): any {
        if (columnMetadata.transformer)
            value = ApplyValueTransformers.transformTo(
                columnMetadata.transformer,
                value,
            )

        if (value === null || value === undefined) return value

        if (columnMetadata.type === Boolean) {
            return value === true ? 1 : 0
        } else if (columnMetadata.type === "date") {
            return DateUtils.mixedDateToDate(value)
        } else if (columnMetadata.type === "time") {
            return DateUtils.mixedTimeToDate(value)
        } else if (
            columnMetadata.type === "datetime" ||
            columnMetadata.type === "smalldatetime" ||
            columnMetadata.type === Date
        ) {
            return DateUtils.mixedDateToDate(value, false, false)
        } else if (
            columnMetadata.type === "datetime2" ||
            columnMetadata.type === "datetimeoffset"
        ) {
            return DateUtils.mixedDateToDate(value, false, true)
        } else if (columnMetadata.type === "simple-array") {
            return DateUtils.simpleArrayToString(value)
        } else if (columnMetadata.type === "simple-json") {
            return DateUtils.simpleJsonToString(value)
        } else if (columnMetadata.type === "simple-enum") {
            return DateUtils.simpleEnumToString(value)
        }

        return value
    }

    /**
     * Prepares given value to a value to be persisted, based on its column type or metadata.
     */
    prepareHydratedValue(value: any, columnMetadata: ColumnMetadata): any {
        if (value === null || value === undefined)
            return columnMetadata.transformer
                ? ApplyValueTransformers.transformFrom(
                      columnMetadata.transformer,
                      value,
                  )
                : value

        if (columnMetadata.type === Boolean) {
            value = value ? true : false
        } else if (
            columnMetadata.type === "datetime" ||
            columnMetadata.type === Date ||
            columnMetadata.type === "datetime2" ||
            columnMetadata.type === "smalldatetime" ||
            columnMetadata.type === "datetimeoffset"
        ) {
            value = DateUtils.normalizeHydratedDate(value)
        } else if (columnMetadata.type === "date") {
            value = DateUtils.mixedDateToDateString(value)
        } else if (columnMetadata.type === "time") {
            value = DateUtils.mixedTimeToString(value)
        } else if (columnMetadata.type === "simple-array") {
            value = DateUtils.stringToSimpleArray(value)
        } else if (columnMetadata.type === "simple-json") {
            value = DateUtils.stringToSimpleJson(value)
        } else if (columnMetadata.type === "simple-enum") {
            value = DateUtils.stringToSimpleEnum(value, columnMetadata)
        } else if (columnMetadata.type === Number) {
            // convert to number if number
            value = !isNaN(+value) ? parseInt(value) : value
        }

        if (columnMetadata.transformer)
            value = ApplyValueTransformers.transformFrom(
                columnMetadata.transformer,
                value,
            )

        return value
    }

    /**
     * Creates a database type from a given column metadata.
     */
    normalizeType(column: {
        type?: ColumnType
        length?: number | string
        precision?: number | null
        scale?: number
    }): string {
        if (column.type === Number || column.type === "integer") {
            return "int"
        } else if (column.type === String) {
            return "nvarchar"
        } else if (column.type === Date) {
            return "datetime"
        } else if (column.type === Boolean) {
            return "bit"
        } else if ((column.type as any) === Buffer) {
            return "binary"
        } else if (column.type === "uuid") {
            return "uniqueidentifier"
        } else if (
            column.type === "simple-array" ||
            column.type === "simple-json"
        ) {
            return "ntext"
        } else if (column.type === "simple-enum") {
            return "nvarchar"
        } else if (column.type === "dec") {
            return "decimal"
        } else if (column.type === "double precision") {
            return "float"
        } else if (column.type === "rowversion") {
            return "timestamp" // the rowversion type's name in SQL server metadata is timestamp
        } else {
            return (column.type as string) || ""
        }
    }

    /**
     * Normalizes "default" value of the column.
     */
    normalizeDefault(columnMetadata: ColumnMetadata): string | undefined {
        const defaultValue = columnMetadata.default

        if (typeof defaultValue === "number") {
            return `${defaultValue}`
        }

        if (typeof defaultValue === "boolean") {
            return defaultValue ? "1" : "0"
        }

        if (typeof defaultValue === "function") {
            const value = defaultValue()
            if (value.toUpperCase() === "CURRENT_TIMESTAMP") {
                return "getdate()"
            }
            return value
        }

        if (typeof defaultValue === "string") {
            return `'${defaultValue}'`
        }

        if (defaultValue === undefined || defaultValue === null) {
            return undefined
        }

        return `${defaultValue}`
    }

    /**
     * Normalizes "isUnique" value of the column.
     */
    normalizeIsUnique(column: ColumnMetadata): boolean {
        return column.entityMetadata.uniques.some(
            (uq) => uq.columns.length === 1 && uq.columns[0] === column,
        )
    }

    /**
     * Returns default column lengths, which is required on column creation.
     */
    getColumnLength(column: ColumnMetadata | TableColumn): string {
        if (column.length) return column.length.toString()

        if (
            column.type === "varchar" ||
            column.type === "nvarchar" ||
            column.type === String
        )
            return "255"

        return ""
    }

    /**
     * Creates column type definition including length, precision and scale
     */
    createFullType(column: TableColumn): string {
        // The Database Engine determines the data type of the computed column by applying the rules
        // of data type precedence to the expressions specified in the formula.
        if (column.asExpression) return ""

        let type = column.type

        // used 'getColumnLength()' method, because SqlServer sets `varchar` and `nvarchar` length to 1 by default.
        if (this.getColumnLength(column)) {
            type += `(${this.getColumnLength(column)})`
        } else if (
            column.precision !== null &&
            column.precision !== undefined &&
            column.scale !== null &&
            column.scale !== undefined
        ) {
            type += `(${column.precision},${column.scale})`
        } else if (
            column.precision !== null &&
            column.precision !== undefined
        ) {
            type += `(${column.precision})`
        }

        if (column.isArray) type += " array"

        return type
    }

    /**
     * Obtains a new database connection to a master server.
     * Used for replication.
     * If replication is not setup then returns default connection's database connection.
     */
    obtainMasterConnection(): Promise<any> {
        if (!this.master) {
            return Promise.reject(new TypeORMError("Driver not Connected"))
        }

        return Promise.resolve(this.master)
    }

    /**
     * Obtains a new database connection to a slave server.
     * Used for replication.
     * If replication is not setup then returns master (default) connection's database connection.
     */
    obtainSlaveConnection(): Promise<any> {
        if (!this.slaves.length) return this.obtainMasterConnection()

        const random = Math.floor(Math.random() * this.slaves.length)
        return Promise.resolve(this.slaves[random])
    }

    /**
     * Creates generated map of values generated or returned by database after INSERT query.
     */
    createGeneratedMap(metadata: EntityMetadata, insertResult: ObjectLiteral) {
        if (!insertResult) return undefined

        return Object.keys(insertResult).reduce((map, key) => {
            const column = metadata.findColumnWithDatabaseName(key)
            if (column) {
                OrmUtils.mergeDeep(
                    map,
                    column.createValueMap(
                        this.prepareHydratedValue(insertResult[key], column),
                    ),
                )
            }
            return map
        }, {} as ObjectLiteral)
    }

    /**
     * Differentiate columns of this table and columns from the given column metadatas columns
     * and returns only changed.
     */
    findChangedColumns(
        tableColumns: TableColumn[],
        columnMetadatas: ColumnMetadata[],
    ): ColumnMetadata[] {
        return columnMetadatas.filter((columnMetadata) => {
            const tableColumn = tableColumns.find(
                (c) => c.name === columnMetadata.databaseName,
            )
            if (!tableColumn) return false // we don't need new columns, we only need exist and changed

            const isColumnChanged =
                tableColumn.name !== columnMetadata.databaseName ||
                this.compareColumnType(tableColumn, columnMetadata) ||
                this.compareColumnLength(tableColumn, columnMetadata) ||
                tableColumn.precision !== columnMetadata.precision ||
                tableColumn.scale !== columnMetadata.scale ||
                // || tableColumn.comment !== columnMetadata.comment || // todo
                tableColumn.isGenerated !== columnMetadata.isGenerated ||
                (!tableColumn.isGenerated &&
                    this.lowerDefaultValueIfNecessary(
                        this.normalizeDefault(columnMetadata),
                    ) !==
                        this.lowerDefaultValueIfNecessary(
                            tableColumn.default,
                        )) || // we included check for generated here, because generated columns already can have default values
                tableColumn.isPrimary !== columnMetadata.isPrimary ||
                tableColumn.isNullable !== columnMetadata.isNullable ||
                tableColumn.asExpression !== columnMetadata.asExpression ||
                tableColumn.generatedType !== columnMetadata.generatedType ||
                tableColumn.isUnique !==
                    this.normalizeIsUnique(columnMetadata) ||
                (tableColumn.enum &&
                    columnMetadata.enum &&
                    !OrmUtils.isArraysEqual(
                        tableColumn.enum,
                        columnMetadata.enum.map((val) => val + ""),
                    ))

            // DEBUG SECTION
            // if (isColumnChanged) {
            //     console.log("table:", columnMetadata.entityMetadata.tableName)
            //     console.log(
            //         "name:",
            //         tableColumn.name,
            //         columnMetadata.databaseName,
            //     )
            //     console.log(
            //         "type:",
            //         tableColumn.type,
            //         this.normalizeType(columnMetadata),
            //         this.compareColumnType(tableColumn, columnMetadata),
            //     )
            //     console.log(
            //         "length:",
            //         tableColumn.length,
            //         columnMetadata.length,
            //         this.compareColumnLength(tableColumn, columnMetadata),
            //     )
            //     console.log(
            //         "precision:",
            //         tableColumn.precision,
            //         columnMetadata.precision,
            //     )
            //     console.log("scale:", tableColumn.scale, columnMetadata.scale)
            //     console.log(
            //         "isGenerated:",
            //         tableColumn.isGenerated,
            //         columnMetadata.isGenerated,
            //     )
            //     console.log(
            //         "isGenerated 2:",
            //         !tableColumn.isGenerated &&
            //             this.lowerDefaultValueIfNecessary(
            //                 this.normalizeDefault(columnMetadata),
            //             ) !==
            //                 this.lowerDefaultValueIfNecessary(
            //                     tableColumn.default,
            //                 ),
            //     )
            //     console.log(
            //         "isPrimary:",
            //         tableColumn.isPrimary,
            //         columnMetadata.isPrimary,
            //     )
            //     console.log(
            //         "isNullable:",
            //         tableColumn.isNullable,
            //         columnMetadata.isNullable,
            //     )
            //     console.log(
            //         "asExpression:",
            //         tableColumn.asExpression,
            //         columnMetadata.asExpression,
            //     )
            //     console.log(
            //         "generatedType:",
            //         tableColumn.generatedType,
            //         columnMetadata.generatedType,
            //     )
            //     console.log(
            //         "isUnique:",
            //         tableColumn.isUnique,
            //         this.normalizeIsUnique(columnMetadata),
            //     )
            //     console.log("==========================================")
            // }

            return isColumnChanged
        })
    }

    /**
     * Returns true if driver supports RETURNING / OUTPUT statement.
     */
    isReturningSqlSupported(): boolean {
        if (
            this.options.options &&
            this.options.options.disableOutputReturning
        ) {
            return false
        }
        return true
    }

    /**
     * Returns true if driver supports uuid values generation on its own.
     */
    isUUIDGenerationSupported(): boolean {
        return true
    }

    /**
     * Returns true if driver supports fulltext indices.
     */
    isFullTextColumnTypeSupported(): boolean {
        return false
    }

    /**
     * Creates an escaped parameter.
     */
    createParameter(parameterName: string, index: number): string {
        return this.parametersPrefix + index
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Sql server's parameters needs to be wrapped into special object with type information about this value.
     * This method wraps given value into MssqlParameter based on its column definition.
     */
    parametrizeValue(column: ColumnMetadata, value: any) {
        // if its already MssqlParameter then simply return it
        if (InstanceChecker.isMssqlParameter(value)) return value

        const normalizedType = this.normalizeType({ type: column.type })
        if (column.length) {
            return new MssqlParameter(
                value,
                normalizedType as any,
                column.length as any,
            )
        } else if (
            column.precision !== null &&
            column.precision !== undefined &&
            column.scale !== null &&
            column.scale !== undefined
        ) {
            return new MssqlParameter(
                value,
                normalizedType as any,
                column.precision,
                column.scale,
            )
        } else if (
            column.precision !== null &&
            column.precision !== undefined
        ) {
            return new MssqlParameter(
                value,
                normalizedType as any,
                column.precision,
            )
        } else if (column.scale !== null && column.scale !== undefined) {
            return new MssqlParameter(
                value,
                normalizedType as any,
                column.scale,
            )
        }

        return new MssqlParameter(value, normalizedType as any)
    }

    /**
     * Recursively wraps values (including those inside FindOperators) into MssqlParameter instances,
     * ensuring correct type metadata is passed to the SQL Server driver.
     *
     * - If the value is a FindOperator containing an array, all elements are individually parametrized.
     * - If the value is a non-raw FindOperator, a transformation is applied to its internal value.
     * - Otherwise, the value is passed directly to parametrizeValue for wrapping.
     *
     * This ensures SQL Server receives properly typed parameters for queries involving operators like
     * In, MoreThan, Between, etc.
     */
    parametrizeValues(column: ColumnMetadata, value: any) {
        if (value instanceof FindOperator) {
            if (value.type !== "raw") {
                value.transformValue({
                    to: (v) => this.parametrizeValues(column, v),
                    from: (v) => v,
                })
            }

            return value
        }

        return this.parametrizeValue(column, value)
    }

    /**
     * Sql server's parameters needs to be wrapped into special object with type information about this value.
     * This method wraps all values of the given object into MssqlParameter based on their column definitions in the given table.
     */
    parametrizeMap(tablePath: string, map: ObjectLiteral): ObjectLiteral {
        // find metadata for the given table
        if (!this.connection.hasMetadata(tablePath))
            // if no metadata found then we can't proceed because we don't have columns and their types
            return map
        const metadata = this.connection.getMetadata(tablePath)

        return Object.keys(map).reduce((newMap, key) => {
            const value = map[key]

            // find column metadata
            const column = metadata.findColumnWithDatabaseName(key)
            if (!column)
                // if we didn't find a column then we can't proceed because we don't have a column type
                return value

            newMap[key] = this.parametrizeValue(column, value)
            return newMap
        }, {} as ObjectLiteral)
    }

    buildTableVariableDeclaration(
        identifier: string,
        columns: ColumnMetadata[],
    ): string {
        const outputColumns = columns.map((column) => {
            return `${this.escape(column.databaseName)} ${this.createFullType(
                new TableColumn({
                    name: column.databaseName,
                    type: this.normalizeType(column),
                    length: column.length,
                    isNullable: column.isNullable,
                    isArray: column.isArray,
                }),
            )}`
        })

        return `DECLARE ${identifier} TABLE (${outputColumns.join(", ")})`
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * If driver dependency is not given explicitly, then try to load it via "require".
     */
    protected loadDependencies(): void {
        try {
            const mssql = this.options.driver || PlatformTools.load("mssql")
            this.mssql = mssql
        } catch (e) {
            // todo: better error for browser env
            throw new DriverPackageNotInstalledError("SQL Server", "mssql")
        }
    }

    protected compareColumnType(
        tableColumn: TableColumn,
        columnMetadata: ColumnMetadata,
    ): boolean {
        // The Database Engine determines the data type of the computed column by applying the rules
        // of data type precedence to the expressions specified in the formula.
        if (columnMetadata.asExpression) return false

        return tableColumn.type !== this.normalizeType(columnMetadata)
    }

    protected compareColumnLength(
        tableColumn: TableColumn,
        columnMetadata: ColumnMetadata,
    ): boolean {
        // The Database Engine determines the data type of the computed column by applying the rules
        // of data type precedence to the expressions specified in the formula.
        if (columnMetadata.asExpression) return false

        return (
            tableColumn.length.toUpperCase() !==
            this.getColumnLength(columnMetadata).toUpperCase()
        )
    }

    protected lowerDefaultValueIfNecessary(value: string | undefined) {
        // SqlServer saves function calls in default value as lowercase https://github.com/typeorm/typeorm/issues/2733
        if (!value) {
            return value
        }
        return value
            .split(`'`)
            .map((v, i) => {
                return i % 2 === 1 ? v : v.toLowerCase()
            })
            .join(`'`)
    }

    /**
     * Creates a new connection pool for a given database credentials.
     */
    protected createPool(
        options: SqlServerConnectionOptions,
        credentials: SqlServerConnectionCredentialsOptions,
    ): Promise<any> {
        credentials = Object.assign(
            {},
            credentials,
            DriverUtils.buildDriverOptions(credentials),
        ) // todo: do it better way

        // todo: credentials.domain is deprecation. remove it in future
        const authentication = !credentials.domain
            ? credentials.authentication
            : {
                  type: "ntlm",
                  options: {
                      domain: credentials.domain,
                      userName: credentials.username,
                      password: credentials.password,
                  },
              }
        // build connection options for the driver
        const connectionOptions = Object.assign(
            {},
            {
                connectionTimeout: this.options.connectionTimeout,
                requestTimeout: this.options.requestTimeout,
                stream: this.options.stream,
                pool: this.options.pool,
                options: this.options.options,
            },
            {
                server: credentials.host,
                database: credentials.database,
                port: credentials.port,
                user: credentials.username,
                password: credentials.password,
                authentication: authentication,
            },
            options.extra || {},
        )

        // set default useUTC option if it hasn't been set
        if (!connectionOptions.options) {
            connectionOptions.options = { useUTC: false }
        } else if (!connectionOptions.options.useUTC) {
            Object.assign(connectionOptions.options, { useUTC: false })
        }

        // Match the next release of tedious for configuration options
        // Also prevents warning messages.
        Object.assign(connectionOptions.options, { enableArithAbort: true })

        // pooling is enabled either when its set explicitly to true,
        // either when its not defined at all (e.g. enabled by default)
        return new Promise<void>((ok, fail) => {
            const pool = new this.mssql.ConnectionPool(connectionOptions)

            const { logger } = this.connection

            const poolErrorHandler =
                (options.pool && options.pool.errorHandler) ||
                ((error: any) =>
                    logger.log("warn", `MSSQL pool raised an error. ${error}`))
            /**
             * Attaching an error handler to pool errors is essential, as, otherwise, errors raised will go unhandled and
             * cause the hosting app to crash.
             */
            pool.on("error", poolErrorHandler)

            const connection = pool.connect((err: any) => {
                if (err) return fail(err)
                ok(connection)
            })
        })
    }
}
