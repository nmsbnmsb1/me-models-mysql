const Model = require('./../../me-models/lib').default;
const Mysql=require('./../lib')

Model.setCommon({ logConnect: true, logSql: true, logger: (msg) => console.log(msg) });
Model.addConfig(
	'mysql',
	{
		handle: Mysql,
		user: 'semi', // 用户名
		password: 'semi', // 密码
		database: 'Semi', // 数据库
		host: '10.0.0.102', // host
		port: 4004, // 端口
		connectionLimit: 1, // 连接池的连接个数，默认为 1
		prefix: '', // 数据表前缀，如果一个数据库里有多个项目，那项目之间的数据表可以通过前缀来区分
		acquireWaitTimeout: 0, // 等待连接的超时时间，避免获取不到连接一直卡在那里，开发环境下有用
		reuseDB: false, // 是否复用数据库连接，事务的时候可能会用到
	},
	true
);

let m = Model.get('test');

(async () => {
	await m.checkTable({
		id: true,
		uuid: { type: 'varchar(36)', u: true },
		username: { type: 'varchar(64)' },
		password: { type: 'varchar(64)', nn: true },
		loade: { type: 'tinyint(1)', default: 1 },
		sp: true,
	});
	// await m.addMany2(
	// 	[
	// 		{ uuid: '111', username: 'username1', password: 'password1' },
	// 		{ uuid: '222', password: 'password2' },
	// 	],
	// 	{ ingore: true }
	// );

	//UPDATE `test` SET `uuid`='222',`password`='aaaa \" \"',`loade`=89 WHERE ( `id` = 2 )
	await m.updateMany2([{ id: 2, password: `bbbb " "`, loade: 89 }], { mode: 'case_when', ignoreKeys: ['id', 'uuid'] });
})();
