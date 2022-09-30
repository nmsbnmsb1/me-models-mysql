"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const think_helper_1 = __importDefault(require("think-helper"));
const think_model_mysql_1 = __importDefault(require("think-model-mysql"));
let Cls = think_model_mysql_1.default;
const oldGetSchema = Cls.Schema.prototype.getSchema;
Cls.Schema.prototype.getSchema = async function (table = this.table) {
    const fs = await oldGetSchema.apply(this, [table]);
    let checked;
    for (const f in fs) {
        checked = fs[f].__checked;
        break;
    }
    if (!checked) {
        for (const f of await this.query.query(`SHOW COLUMNS FROM ${this.parser.parseKey(table)}`)) {
            if (f.Default !== null) {
                if (f.Type.indexOf('int') >= 0)
                    f.Default = parseInt(f.Default, 10);
            }
            fs[f.Field].default = f.Default;
            fs[f.Field].__checked = true;
        }
    }
    return fs;
};
Cls.prototype.updateMany2ByTempTable = async function (foptions) {
    const { options, dataList, key, fs, cols } = foptions;
    const tmpTable = `tmp_${options.table}_${Date.now()}`;
    const createFs = [];
    const updateFs = [];
    const vs = [];
    for (const f of fs) {
        const col = cols[f];
        let createSql = `\`${f}\` ${col.type.toUpperCase()} `;
        createFs.push(createSql.trim());
        updateFs.push(`${options.table}.${f} = ${tmpTable}.${f}`);
    }
    for (const data of dataList) {
        const v = [];
        for (const f of fs)
            v.push(`'${data[f]}'`);
        vs.push(v.join(','));
    }
    const createSql = `CREATE TEMPORARY TABLE \`${tmpTable}\` (${createFs.join(',')});`;
    await this.query.query(createSql.replace(/[\r\n]/g, '').replace(/\s+/g, ' '));
    await this.query.query(`INSERT INTO \`${tmpTable}\` (${fs.join(',')}) VALUES (${vs.join('),(')});`);
    await this.query.query(`UPDATE \`${options.table}\`,\`${tmpTable}\` SET ${updateFs.join(',')} WHERE ${options.table}.${key}=${tmpTable}.${key};`);
    await this.query.query(`DROP TABLE \`${tmpTable}\`;`);
};
Cls.prototype.updateMany2ByCaseWhen = async function (foptions) {
    const { options, dataList, key, fs, cols } = foptions;
    const updateFs = [];
    const keyvs = [];
    const keyvm = {};
    for (const f of fs) {
        if (options.ignoreKeys && options.ignoreKeys.indexOf(f) >= 0) {
            if (f === key) {
                for (const data of dataList) {
                    const keyValue = this.parser.parseValue(data[key]);
                    if (think_helper_1.default.isString(keyValue) || think_helper_1.default.isNumber(keyValue)) {
                        if (!keyvm[keyValue]) {
                            keyvs.push(keyValue);
                            keyvm[keyValue] = 1;
                        }
                    }
                }
            }
        }
        else {
            const vs = [];
            for (const data of dataList) {
                const keyValue = this.parser.parseValue(data[key]);
                const value = this.parser.parseValue(data[f]);
                if ((think_helper_1.default.isString(keyValue) || think_helper_1.default.isNumber(keyValue)) && (think_helper_1.default.isString(value) || think_helper_1.default.isNumber(value))) {
                    if (!keyvm[keyValue]) {
                        keyvs.push(keyValue);
                        keyvm[keyValue] = 1;
                    }
                    vs.push(`WHEN ${keyValue} THEN ${value}`);
                }
            }
            updateFs.push(`${this.parseKey(f)} = CASE ${this.parseKey(key)} ${vs.join(' ')} END`);
        }
    }
    await this.query.query(`UPDATE \`${options.table}\` SET ${updateFs.join(',')} WHERE ${this.parseKey(key)} IN (${keyvs.join(`,`)});`);
};
Cls.prototype.isTableExists = async function (tableName) {
    let results = await this.query.query(`SHOW TABLES LIKE '${tableName}';`);
    return think_helper_1.default.isEmpty(results) || results.length <= 0 ? false : results[0].is_exist > 0;
};
Cls.prototype.handleFields = function (fields) {
    fields = { ...fields };
    if (fields.id === true) {
        fields.id = { type: 'INTEGER', nn: true, pk: true, ai: true };
    }
    if (fields.sp === true) {
        delete fields.sp;
        fields.create_time = { type: 'BIGINT', default: 0 };
        fields.update_time = { type: 'BIGINT', default: 0 };
        fields.delete_time = { type: 'BIGINT', default: 0 };
    }
    return fields;
};
Cls.prototype.getCreateDetailSql = function (option) {
    let detailSql = `${option.type.toUpperCase()} `;
    if (option.nn === true)
        detailSql += 'NOT NULL ';
    if (option.pk === true)
        detailSql += 'PRIMARY KEY ';
    if (option.ai === true)
        detailSql += 'AUTO_INCREMENT ';
    if (option.u === true)
        detailSql += 'UNIQUE ';
    if (option.default !== undefined)
        detailSql += `DEFAULT ${option.default} `;
    return detailSql.trim();
};
Cls.prototype.createTable = async function (tableName, fields) {
    fields = this.handleFields(fields);
    const fieldArr = [];
    for (const name in fields)
        fieldArr.push(`\`${name}\` ${this.getCreateDetailSql(fields[name])}`);
    let sql = `CREATE TABLE \`${tableName}\` (${fieldArr.join(',')});`;
    return this.query.query(sql.replace(/[\r\n]/g, '').replace(/\s+/g, ' '));
};
Cls.prototype.checkTable = async function (tableName, fields) {
    let op = '';
    let tableInfo = await this.query.query(`SHOW TABLES LIKE '${tableName}';`);
    if (think_helper_1.default.isEmpty(tableInfo) || tableInfo.length < 0) {
        op = 'add';
        await this.createTable(tableName, fields);
    }
    else {
        op = 'update';
        fields = this.handleFields(fields);
        delete fields.id;
        const columns = await this.query.query(`SHOW COLUMNS FROM \`${tableName}\``);
        for (const field in fields) {
            let col;
            for (let i = 0; i < columns.length; i++) {
                if (field === columns[i].Field) {
                    col = columns[i];
                    break;
                }
            }
            if (col) {
                const options = fields[field];
                if (options.type.toLowerCase() !== col.Type.toLowerCase() ||
                    (!options.nn && col.Null === 'NO') ||
                    (options.nn && col.Null === 'YES') ||
                    (!options.ai && col.Extra === 'auto_increment') ||
                    (options.ai && col.Extra !== 'auto_increment') ||
                    (!options.u && col.Key === 'UNI') ||
                    (options.u && col.Key !== 'UNI') ||
                    ((options.default === undefined || options.default === null) && col.Default !== null) ||
                    (options.default !== undefined && options.default !== null && `${options.default}` !== col.Default)) {
                    await this.query.query(`ALTER TABLE \`${tableName}\` MODIFY \`${field}\` ${this.getCreateDetailSql(fields[field])} `);
                }
            }
            else {
                await this.query.query(`ALTER TABLE \`${tableName}\` ADD \`${field}\` ${this.getCreateDetailSql(fields[field])} `);
            }
        }
    }
    return op;
};
Cls.prototype.checkIndex = async function (indexName, tableName, columnNames, options) {
    const indexes = await this.query.query(`SHOW INDEX FROM \`${tableName}\` WHERE key_name='${indexName}';`);
    if (think_helper_1.default.isEmpty(indexes) || indexes.length <= 0) {
        let prefix = options && options.unique ? 'UNIQUE' : '';
        let using = options && options.type ? `USING ${options.type.toUpperCase()}` : 'USING BTREE';
        await this.query.query(`CREATE ${prefix} INDEX '${indexName}' ${using} ON \`${tableName}\` ('${columnNames.join("','")}');`);
    }
};
exports.default = Cls;
//# sourceMappingURL=index.js.map