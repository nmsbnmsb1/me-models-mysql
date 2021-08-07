import helper from 'think-helper';
import MySQLAdapter from 'think-model-mysql';

let Cls: any = MySQLAdapter;
//
//fix think-model-mysql has no default value
const oldGetSchema = Cls.Schema.prototype.getSchema;
Cls.Schema.prototype.getSchema = async function (table = this.table) {
	const fs = await oldGetSchema.apply(this, [table]);
	//检查是否recheck过
	let checked;
	for (const f in fs) {
		checked = fs[f].__checked;
		break;
	}
	if (!checked) {
		//console.log('recheck');
		for (const f of await this.query.query(`SHOW COLUMNS FROM ${this.parser.parseKey(table)}`)) {
			//console.log(f);
			if (f.Default !== null) {
				if (f.Type.indexOf('int') >= 0) f.Default = parseInt(f.Default, 10);
			}
			fs[f.Field].default = f.Default;
			fs[f.Field].__checked = true;
		}
	}
	return fs;
};
//通过创建临时表批量更新
Cls.prototype.updateMany2ByTempTable = async function (foptions: { options: any; dataList: any[]; key: string; fs: any; cols: any }) {
	const { options, dataList, key, fs, cols } = foptions;
	//
	const tmpTable = `tmp_${options.table}_${Date.now()}`;
	const createFs: string[] = [];
	const updateFs: string[] = [];
	const vs = [];
	for (const f of fs) {
		const col = cols[f];
		//
		let createSql = `\`${f}\` ${col.type.toUpperCase()} `;
		//if (col.required === true) createSql += 'NOT NULL ';
		//if (col.primary === true) createSql += 'PRIMARY KEY ';
		//if (col.autoIncrement === true) createSql += 'AUTO_INCREMENT ';
		//if (col.unique === true) createSql += 'UNIQUE ';
		//if (col.default !== undefined && col.default !== null) createSql += `DEFAULT ${col.default} `;
		createFs.push(createSql.trim());
		//
		updateFs.push(`${options.table}.${f} = ${tmpTable}.${f}`);
	}
	//
	for (const data of dataList) {
		const v = [];
		for (const f of fs) v.push(`'${data[f]}'`);
		vs.push(v.join(','));
	}
	//
	const createSql = `CREATE TEMPORARY TABLE \`${tmpTable}\` (${createFs.join(',')});`;
	await this.query.query(createSql.replace(/[\r\n]/g, '').replace(/\s+/g, ' '));
	await this.query.query(`INSERT INTO \`${tmpTable}\` (${fs.join(',')}) VALUES (${vs.join('),(')});`);
	await this.query.query(`UPDATE \`${options.table}\`,\`${tmpTable}\` SET ${updateFs.join(',')} WHERE ${options.table}.${key}=${tmpTable}.${key};`);
	await this.query.query(`DROP TABLE \`${tmpTable}\`;`);
};
//通过Case When 批量更新
Cls.prototype.updateMany2ByCaseWhen = async function (foptions: { options: any; dataList: any[]; key: string; fs: any; cols: any }) {
	const { options, dataList, key, fs, cols } = foptions;
	//
	const updateFs: string[] = [];
	const keyvs = [];
	const keyvm = {};
	//生成update语句
	for (const f of fs) {
		//如果字段不需要更新
		if (options.ignoreKeys && options.ignoreKeys.indexOf(f) >= 0) {
			if (f === key) {
				for (const data of dataList) {
					const keyValue = this.parser.parseValue(data[key]);
					if (helper.isString(keyValue) || helper.isNumber(keyValue)) {
						if (!keyvm[keyValue]) {
							keyvs.push(keyValue);
							keyvm[keyValue] = 1;
						}
					}
				}
			}
		} else {
			const vs = [];
			for (const data of dataList) {
				const keyValue = this.parser.parseValue(data[key]);
				const value = this.parser.parseValue(data[f]);
				if ((helper.isString(keyValue) || helper.isNumber(keyValue)) && (helper.isString(value) || helper.isNumber(value))) {
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

//
Cls.prototype.isTableExists = async function (tableName: string) {
	let results = await this.query.query(`SHOW TABLES LIKE '${tableName}';`);
	return helper.isEmpty(results) || results.length <= 0 ? false : results[0].is_exist > 0;
};
Cls.prototype.handleFields = function (fields: any) {
	fields = { ...fields };
	if (fields.id === true) {
		delete fields.id;
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
Cls.prototype.getCreateDetailSql = function (option: { type: string; nn?: boolean; pk?: boolean; ai?: boolean; u?: boolean; default?: any }) {
	let detailSql = `${option.type.toUpperCase()} `;
	if (option.nn === true) detailSql += 'NOT NULL ';
	if (option.pk === true) detailSql += 'PRIMARY KEY ';
	if (option.ai === true) detailSql += 'AUTO_INCREMENT ';
	if (option.u === true) detailSql += 'UNIQUE ';
	if (option.default !== undefined) detailSql += `DEFAULT ${option.default} `;
	return detailSql.trim();
};
Cls.prototype.createTable = async function (
	tableName: string,
	fields: { id: any; sp: any; [name: string]: { type: string; nn?: boolean; pk?: boolean; ai?: boolean; u?: boolean; default?: any } }
) {
	fields = this.handleFields(fields);
	//
	const fieldArr: string[] = [];
	for (const name in fields) fieldArr.push(`\`${name}\` ${this.getCreateDetailSql(fields[name])}`);
	let sql = `CREATE TABLE \`${tableName}\` (${fieldArr.join(',')});`;
	return this.query.query(sql.replace(/[\r\n]/g, '').replace(/\s+/g, ' '));
};
Cls.prototype.checkTable = async function (
	tableName: string,
	fields: { id: any; sp: any; [name: string]: { type: string; nn?: boolean; pk?: boolean; ai?: boolean; u?: boolean; default?: any } }
) {
	let op = '';
	let tableInfo = await this.query.query(`SHOW TABLES LIKE '${tableName}';`);
	if (helper.isEmpty(tableInfo) || tableInfo.length < 0) {
		op = 'add';
		await this.createTable(tableName, fields);
	} else {
		op = 'update';
		fields = this.handleFields(fields);
		delete fields.id; //主键不能更改
		//
		const columns = await this.query.query(`SHOW COLUMNS FROM \`${tableName}\``);
		// 读取创建sql字符串
		for (const field in fields) {
			let col;
			for (let i = 0; i < columns.length; i++) {
				if (field === columns[i].Field) {
					col = columns[i];
					break;
				}
			}
			//
			if (col) {
				//修改
				const options = fields[field];
				// console.log(field, options.default, col.Default, `${options.default}` !== col.Default, col);
				if (
					options.type.toLowerCase() !== col.Type.toLowerCase() ||
					(!options.nn && col.Null === 'NO') ||
					(options.nn && col.Null === 'YES') ||
					(!options.ai && col.Extra === 'auto_increment') ||
					(options.ai && col.Extra !== 'auto_increment') ||
					(!options.u && col.Key === 'UNI') ||
					(options.u && col.Key !== 'UNI') ||
					((options.default === undefined || options.default === null) && col.Default !== null) ||
					(options.default !== undefined && options.default !== null && `${options.default}` !== col.Default)
				) {
					await this.query.query(`ALTER TABLE \`${tableName}\` MODIFY \`${field}\` ${this.getCreateDetailSql(fields[field])} `);
				}
			} else {
				//增加
				await this.query.query(`ALTER TABLE \`${tableName}\` ADD \`${field}\` ${this.getCreateDetailSql(fields[field])} `);
			}
		}
	}
	return op;
};
Cls.prototype.checkIndex = async function (indexName: string, tableName: string, columnName: string) {
	const indexes = await this.query.query(`SHOW INDEX FROM \`${tableName}\` WHERE key_name='${indexName}';`);
	if (helper.isEmpty(indexes) || indexes.length <= 0) {
		await this.query.query(`CREATE INDEX '${indexName}' ON \`${tableName}\` (\`${columnName}\`);`);
	}
};

export default Cls;
