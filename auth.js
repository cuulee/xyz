module.exports = { init, authToken }

function init(fastify) {

    // Get ACL table name from env settings.
    const user_table = (process.env.PUBLIC || process.env.PRIVATE) ?
        (process.env.PUBLIC || process.env.PRIVATE).split('|')[1] :
        null;

    // Register the ACL database from env settings connection string.
    if (user_table) {
        fastify.register(require('fastify-postgres'), {
            connectionString: (process.env.PUBLIC || process.env.PRIVATE).split('|')[0],
            name: 'users'
        });
    }

    fastify.register((fastify, opts, next) => {

        fastify.route({
            method: 'GET',
            url: '/logout',
            handler: (req, res) => {
                return res
                    .setCookie('xyz_session', fastify.jwt.sign({ redirect: global.dir + '/' }), { path: process.env.DIR || '/' })
                    .setCookie('xyz_user', fastify.jwt.sign({ access: 'public', status: 'Logged out from application' }), { path: process.env.DIR || '/' })
                    .redirect(process.env.DIR || '/');
            }
        });

        fastify.route({
            method: 'GET',
            url: '/login',
            handler: (req, res) => {

                // Get status from user token.
                let msg = '';
                if (req.cookies && req.cookies.xyz_user) {
                    const user_token = fastify.jwt.decode(req.cookies.xyz_user);
                    msg = user_token.status;

                    // Empty status in user token.
                    res.setCookie('xyz_user', fastify.jwt.sign({ status: '' }), {
                        path: process.env.DIR || '/'
                    });
                }

                // Render login view with status msg.
                res
                    .type('text/html')
                    .send(require('jsrender')
                        .templates('./views/login.html')
                        .render({ dir: global.dir, msg: msg }));
            }
        });

        fastify.route({
            method: 'POST',
            url: '/login',
            handler: async (req, res) => {

                let redirect = '';
                if (req.cookies && req.cookies.xyz_session) {
                    const session_token = fastify.jwt.decode(req.cookies.xyz_session);
                    redirect = session_token.redirect;
                    delete session_token.redirect;

                    // Empty status in user token.
                    res.setCookie('xyz_session', fastify.jwt.sign(session_token), {
                        path: process.env.DIR || '/'
                    });
                }

                var user_db = await fastify.pg.users.connect();
                var result = await user_db.query(
                    `SELECT * FROM ${user_table} WHERE email = $1;`,
                    [req.body.email]
                );
                user_db.release();

                const user = result.rows[0];

                if (!user) {
                    return res
                        .setCookie('xyz_user', fastify.jwt.sign({
                            status: 'User account not found in access control list.'
                        }), { path: process.env.DIR || '/' })
                        .redirect(global.dir + '/login');
                }

                if (!user.verified) {
                    return res
                        .setCookie('xyz_user', fastify.jwt.sign({
                            email: user.email,
                            status: 'User account email not yet verified.'
                        }), { path: process.env.DIR || '/' })
                        .redirect(global.dir + '/login');
                }

                if (!user.approved) {
                    return res
                        .setCookie('xyz_user', fastify.jwt.sign({
                            email: user.email,
                            status: 'User account not yet approved by site administrator.'
                        }), { path: process.env.DIR || '/' })
                        .redirect(global.dir + '/login');
                }

                // Check password from post body against encrypted password from ACL.
                if (require('bcrypt-nodejs').compareSync(req.body.password, user.password)) {

                    // Password match
                    return res
                        .setCookie('xyz_user', fastify.jwt.sign({
                            email: user.email,
                            verified: user.verified,
                            approved: user.approved,
                            admin: user.admin,
                            access: user.admin ? 'admin' : 'private'
                        }), { path: process.env.DIR || '/' })
                        .redirect(redirect || global.dir || '/');

                } else {

                    // Password does NOT match.
                    var user_db = await fastify.pg.users.connect();
                    var result = await user_db.query(`
                UPDATE ${user_table} SET failedattempts = failedattempts + 1
                WHERE email = $1
                RETURNING failedattempts;`,
                        [req.body.email]);
                    user_db.release();

                    // Check whether failed login attempts exceeds limit.
                    if (result.rows[0].failedattempts >= global.failed_attempts) {

                        // Create a new verification token and remove verified status in ACL.
                        const verificationtoken = require('crypto').randomBytes(20).toString('hex');
                        var user_db = await fastify.pg.users.connect();
                        await user_db.query(`
                    UPDATE ${user_table} SET
                        verified = false,
                        verificationtoken = '${verificationtoken}'
                    WHERE email = $1;`,
                            [req.body.email]);
                        user_db.release();

                        // Sent email with verification link to user.
                        require('./mailer')({
                            to: user.email,
                            subject: `Please verify your GEOLYTIX account (password reset) on ${req.headers.host}${global.dir}`,
                            text: `${global.failed_attempts} failed login attempts have been recorded on this account. \n \n`
                                + `Please verify that you are the account holder: https://${req.headers.host}${global.dir}/admin/user/verify/${verificationtoken} \n \n`
                                + `Verifying the account will reset the failed login attempts.`
                        });

                        return res
                            .setCookie('xyz_user', fastify.jwt.sign({
                                email: user.email,
                                status: `${global.failed_attempts} failed login attempts. Account verification has been removed. <br />`
                                    + `Please check your inbox and confirm that you are the account holder.`
                            }), { path: process.env.DIR || '/' })
                            .redirect(global.dir + '/login');
                    }

                    return res
                        .setCookie('xyz_user', fastify.jwt.sign({
                            email: user.email,
                            status: `Wrong password. ${result.rows[0].failedattempts} failed login attempts.`
                        }), { path: process.env.DIR || '/' })
                        .redirect(global.dir + '/login');
                }
            }
        });

        fastify.route({
            method: 'GET',
            url: '/register',
            handler: (req, res) => {
                res
                    .type('text/html')
                    .send(require('jsrender')
                        .templates('./views/register.html')
                        .render({ dir: global.dir }));
            }
        });

        fastify.route({
            method: 'POST',
            url: '/register',
            handler: async (req, res) => {

                const email = req.body.email;

                // Backend validation of email address.
                if (!/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(email)) {
                    return res
                        .setCookie('xyz_user', fastify.jwt.sign({
                            email: email,
                            status: `Not a valid email address.`
                        }), { path: process.env.DIR || '/' })
                        .redirect(global.dir + '/login');
                }

                var user_db = await fastify.pg.users.connect();
                result = await user_db.query(
                    `SELECT * FROM ${user_table} WHERE email = $1;`,
                    [email]
                );
                user_db.release();

                const user = result.rows[0];
                const password = require('bcrypt-nodejs').hashSync(req.body.password, require('bcrypt-nodejs').genSaltSync(8));
                const verificationtoken = require('crypto').randomBytes(20).toString('hex');

                // set password for existing user and remove existing verification.
                if (user) {
                    var user_db = await fastify.pg.users.connect();
                    await user_db.query(`
                UPDATE ${user_table} SET
                    verified = false,
                    password = '${password}',
                    verificationtoken = '${verificationtoken}'
                WHERE email = $1;`, [email]);
                    user_db.release();

                    require('./mailer')({
                        to: user.email,
                        subject: `Please verify your GEOLYTIX account (password reset) on ${req.headers.host}${global.dir}`,
                        text: `A new password has been set for this account. \n \n`
                            + `Please verify that you are the account holder: https://${req.headers.host}${global.dir}/admin/user/verify/${verificationtoken}`
                    });

                    return res
                        .setCookie('xyz_user', fastify.jwt.sign({
                            email: user.email,
                            status: `You have reset the password <br />`
                                + `A verification mail has been sent to your registered address. <br />`
                                + `Please follow the link in the email to verify that you are the account holder. <br />`
                                + `You must verify your account before you are able to login with your new password.`
                        }), { path: process.env.DIR || '/' })
                        .redirect(global.dir + '/login');
                }

                // Create new user account
                var user_db = await fastify.pg.users.connect();
                await user_db.query(`
            INSERT INTO ${user_table} (email, password, verificationtoken)
            SELECT
                '${email}' AS email,
                '${password}' AS password,
                '${verificationtoken}' AS verificationtoken;`);
                user_db.release();

                require('./mailer')({
                    to: email,
                    subject: `Please verify your GEOLYTIX account on ${req.headers.host}${global.dir}`,
                    text: `A new account for this email address has been registered with ${req.headers.host}${global.dir} \n \n`
                        + `Please verify that you are the account holder: https://${req.headers.host}${global.dir}/admin/user/verify/${verificationtoken} \n \n`
                        + `A site administrator must approve the account before you are able to login. \n \n`
                        + `You will be notified via email once an adimistrator has approved your account.`
                });

                return res
                    .setCookie('xyz_user', fastify.jwt.sign({
                        email: email,
                        status: `We registered your email address in the access control list. <br />`
                            + `A verification mail has been sent to your registered address. <br />`
                            + `Please follow the link in the email to verify that you are the account holder. <br />`
                            + `A site administrator must approve the account before you are able to login. <br />`
                            + `You will be notified via email once an adimistrator has approved your account.`
                    }), { path: process.env.DIR || '/' })
                    .redirect(global.dir + '/login');
            }
        });

        // Open the user admin panel with a list of all user accounts.
        fastify.route({
            method: 'GET',
            url: '/admin/user',
            beforeHandler: fastify.auth([fastify.authAdmin]),
            handler: async (req, res) => {

                // Get user list from ACL.
                var user_db = await fastify.pg.users.connect();
                let result = await user_db.query(`
                    SELECT
                        email,
                        verified,
                        approved,
                        admin,
                        failedattempts
                    FROM ${user_table};`);
                user_db.release();

                res
                    .type('text/html')
                    .send(require('jsrender')
                        .templates('./views/admin.html')
                        .render({
                            users: result.rows,
                            dir: global.dir
                        }));
            }
        });

        // Endpoint for update requests from admin panel.
        fastify.route({
            method: 'POST',
            url: '/admin/user/update',
            beforeHandler: fastify.auth([fastify.authAdmin]),
            handler: async (req, res) => {

                // Get user to update from ACL.
                var user_db = await fastify.pg.users.connect();
                let update = await user_db.query(`
                    UPDATE ${user_table} SET ${req.body.role} = ${req.body.chk}
                    WHERE email = $1;`, [req.body.email]);
                user_db.release();

                // Send email to the user account if an account has been approved.
                if (req.body.role === 'approved' && req.body.chk)
                    await require('./mailer')({
                        to: req.body.email,
                        subject: `This account has been approved for ${req.headers.host}${global.dir}`,
                        text: `You are now able to log on to https://${req.headers.host}${global.dir}`
                    });

                if (update.rowCount === 0) res.code(500).send();
                if (update.rowCount === 1) res.code(200).send();
            }
        });

        // Endpoint for deleting user accounts from admin panel.
        fastify.route({
            method: 'POST',
            url: '/admin/user/delete',
            beforeHandler: fastify.auth([fastify.authAdmin]),
            handler: async (req, res) => {

                // Delete user account in ACL.
                var user_db = await fastify.pg.users.connect();
                let update = await user_db.query(`
                    DELETE FROM ${user_table}
                    WHERE email = $1;`, [req.body.email]);
                user_db.release();

                if (update.rowCount === 0) res.code(500).send();
                if (update.rowCount === 1) {

                    // Sent email to inform user that their account has been deleted.
                    await require('./mailer')({
                        to: req.body.email,
                        subject: `This ${req.headers.host}${global.dir} account has been deleted.`,
                        text: `You will no longer be able to log in to https://${req.headers.host}${global.dir}`
                    });

                    res.code(200).send()
                };

            }
        });

        // Check verification token and verify account
        fastify.route({
            method: 'GET',
            url: '/admin/user/verify/:token',
            handler: async (req, res) => {

                // Find user account in ACL from matching token.
                var user_db = await fastify.pg.users.connect();
                var result = await user_db.query(
                    `SELECT * FROM ${user_table} WHERE verificationtoken = $1;`,
                    [req.params.token]
                );
                user_db.release();

                const user = result.rows[0];

                if (!user) return res.send('Token not found.');

                if (user.verified && user.admin) return res.redirect(global.dir || '/');

                if (user.verified) return res.send('User account has already been verfied but is still awaiting administrator approval.');

                if (!user.approved) {
                    let approvaltoken = require('crypto').randomBytes(20).toString('hex');

                    var user_db = await fastify.pg.users.connect();
                    let update = await user_db.query(`
                        UPDATE ${user_table} SET
                            verified = true,
                            failedattempts = 0,
                            approvaltoken = '${approvaltoken}'
                        WHERE email = $1;`, [user.email]);
                    user_db.release();

                    // Get all admin accounts from the ACL.
                    var user_db = await fastify.pg.users.connect();
                    var result = await user_db.query(`
                        SELECT email
                        FROM ${user_table}
                        WHERE admin = true;`);
                    user_db.release();

                    if (result.rowCount === 0) return res.send('No admin accounts were found.');

                    // Create an array of all admin account emails.
                    let adminmail = result.rows.map(admin => admin.email);

                    // Sent an email to all admin account emails with a request to approve the new user account.
                    require('./mailer')({
                        to: adminmail,
                        subject: `A new account has been verified on ${req.headers.host}${global.dir}`,
                        text: `Please log into the admin panel https://${req.headers.host}${global.dir}/admin/user to approve ${user.email} \n \n`
                            + `You can also approve the account by following this link: https://${req.headers.host}${global.dir}/admin/user/approve/${approvaltoken}`
                    });
                }

                var user_db = await fastify.pg.users.connect();
                let update = await user_db.query(`
                    UPDATE ${user_table} SET
                        verified = true,
                        failedattempts = 0
                    WHERE email = $1;`, [user.email]);
                user_db.release();

                if (user.approved) return res.redirect(global.dir || '/');

                res.send('The account has been verified and is awaiting administrator approval.');
            }
        });

        // Check verification token and approve account
        fastify.route({
            method: 'GET',
            url: '/admin/user/approve/:token',
            beforeHandler: fastify.auth([fastify.authAdmin]),
            handler: async (req, res) => {

                var user_db = await fastify.pg.users.connect();
                var result = await user_db.query(
                    `SELECT * FROM ${user_table} WHERE approvaltoken = $1;`,
                    [req.params.token]
                );
                user_db.release();

                user = result.rows[0];

                if (!user) return res.send('Token not found.');

                var user_db = await fastify.pg.users.connect();
                let update = await user_db.query(`
                                    UPDATE ${user_table} SET
                                        approved = true,
                                        approvaltoken = '${user.approvaltoken}'
                                    WHERE email = $1;`, [user.email]);
                user_db.release();

                require('./mailer')({
                    to: user.email,
                    subject: `This account has been approved on ${req.headers.host}${global.dir}`,
                    text: `You are now able to log on to https://${req.headers.host}${global.dir}`
                });

                res.send('The account has been approved by you. An email has been sent to the account holder.');
            }
        });

        next();

    }, { prefix: global.dir });
}

function authToken(req, res, fastify, access, done) {

    // Pass through if access is public.
    if (access === 'public') {

        var user_cookie = fastify.jwt.sign({ access: 'public' });
        var session_cookie = fastify.jwt.sign({});

        if (!req.cookies.xyz_user) req.cookies.xyz_user = user_cookie;
        if (!req.cookies.xyz_session) req.cookies.xyz_session = session_cookie;

        // Generate an anonymous user token and an empty session token.
        res
            .setCookie('xyz_user', user_cookie, {
                path: process.env.DIR || '/'
            })
            .setCookie('xyz_session', session_cookie, {
                path: process.env.DIR || '/'
            });

        return done();
    }

    // Get user_token from either the cookie or a query.
    let user_token;
    if (req.cookies && req.cookies.xyz_user) {
        user_token = fastify.jwt.decode(req.cookies.xyz_user);
    }
    if (req.query.token) {
        user_token = fastify.jwt.decode(req.query.token);
    }

    // No user_token found.
    if (!user_token) {
        res
            .code(401)
            .setCookie('xyz_user', fastify.jwt.sign({ anonymous: true }), {
                path: process.env.DIR || '/'
            })
            .setCookie('xyz_session', fastify.jwt.sign({ redirect: req.req.url }), {
                path: process.env.DIR || '/'
            });

        if (req.query.noredirect) return res.send('No user token found in request.');

        return res.redirect(global.dir + '/login');
    }

    // Get the current time and the user_token age.
    let time_now = parseInt(Date.now() / 1000),
        token_age = time_now - user_token.iat;

    // Token age exceeds timeout.
    if (token_age >= global.timeout) {
        user_token.status = 'Session timed out.';

        res
            .code(401)
            .setCookie('xyz_user', fastify.jwt.sign(user_token), {
                path: process.env.DIR || '/'
            })
            .setCookie('xyz_session', fastify.jwt.sign({ redirect: req.req.url }), {
                path: process.env.DIR || '/'
            });

        if (req.query.noredirect) return res.send('User token timed out.');

        return res.redirect(global.dir + '/login');
    }

    // Check admin privileges.
    if (access === 'admin' && !user_token.admin) {
        user_token.status = 'Admin authorization required for the requested route.';

        res
            .code(401)
            .setCookie('xyz_user', fastify.jwt.sign(user_token), {
                path: process.env.DIR || '/'
            })
            .setCookie('xyz_session', fastify.jwt.sign({ redirect: req.req.url }), {
                path: process.env.DIR || '/'
            });

        return res.redirect(global.dir + '/login');
    }

    // Check whether user token has an email field.
    if (!user_token.email) {
        res
            .code(401)
            .setCookie('xyz_user', fastify.jwt.sign({ access: 'public' }), {
                path: process.env.DIR || '/'
            })
            .setCookie('xyz_session', fastify.jwt.sign({ redirect: req.req.url }), {
                path: process.env.DIR || '/'
            });

        if (req.query.noredirect) return res.send('Email not defined in token.');

        return res.redirect(global.dir + '/login');
    }

    // Check whether user token is verified.
    if (!user_token.verified) {
        user_token.status = 'User email not verified.';

        res
            .code(401)
            .setCookie('xyz_user', fastify.jwt.sign(user_token), {
                path: process.env.DIR || '/'
            })
            .setCookie('xyz_session', fastify.jwt.sign({ redirect: req.req.url }), {
                path: process.env.DIR || '/'
            });

        if (req.query.noredirect) return res.send('User email not verified.');

        return res.redirect(global.dir + '/login');
    }

    // Check whether user token is verified and approved.
    if (!user_token.approved) {
        user_token.status = 'User email not approved by administrator.';

        res
            .code(401)
            .setCookie('xyz_user', fastify.jwt.sign(user_token), {
                path: process.env.DIR || '/'
            })
            .setCookie('xyz_session', fastify.jwt.sign({ redirect: req.req.url }), {
                path: process.env.DIR || '/'
            });

        if (req.query.noredirect) return res.send('User email not approved by administrator.');

        return res.redirect(global.dir + '/login');
    }

    // Issue a new user token with current time.
    user_token.iat = time_now;
    user_token = fastify.jwt.sign(user_token);

    res.setCookie('xyz_user', user_token, {
        path: process.env.DIR || '/'
    });

    done();
}