module.exports = { get };

async function get(req, res, fastify) {
    let
        x = parseInt(req.params.x),
        y = parseInt(req.params.y),
        z = parseInt(req.params.z),
        m = 20037508.34,
        r = (m * 2) / (Math.pow(2, z)),
        table = req.query.table,
        layer = req.query.layer,
        geom_3857 = req.query.geom_3857 === 'undefined' ? 'geom_3857' : req.query.geom_3857
        id = req.query.qID === 'undefined' ? null : req.query.qID,
        properties = req.query.properties === 'undefined' ? '' : req.query.properties,
        tilecache = req.query.tilecache === 'undefined' ? false : req.query.tilecache,
        user = fastify.jwt.decode(req.cookies.xyz_user || req.query.token);

    // Check whether string params are found in the settings to prevent SQL injections.
    if ([id, table, tilecache, layer, geom_3857, properties]
        .some(val => (typeof val === 'string' && global.workspace[user.access].values.indexOf(val) < 0))) {
        return res.code(406).send('Parameter not acceptable.');
    }
    
    if(properties) properties = `${properties},`;

    if (tilecache) {
        var db_connection = await fastify.pg[req.query.dbs].connect();
        var result = await db_connection.query(`SELECT mvt FROM ${tilecache} WHERE z = ${z} AND x = ${x} AND y = ${y}`);
        db_connection.release();
    }

    if (result && result.rowCount === 1) {
        res
            .type('application/x-protobuf')
            .code(200)
            .send(result.rows[0].mvt);
        return
    }

    // ST_MakeEnvelope() in ST_AsMVT is based on https://github.com/mapbox/postgis-vt-util/blob/master/src/TileBBox.sql
    var q = `
        ${tilecache ? `INSERT INTO ${tilecache} (z, x, y, mvt, tile)` : ''}
        SELECT
            ${z},
            ${x},
            ${y},
            ST_AsMVT(tile, '${layer}', 4096, 'geom') mvt,
            ST_MakeEnvelope(
                ${-m + (x * r)},
                ${ m - (y * r)},
                ${-m + (x * r) + r},
                ${ m - (y * r) - r},
                3857
            ) tile
        FROM (
            SELECT
                ${id} id,
                ${properties}
                ST_AsMVTGeom(
                    ${geom_3857},
                    ST_MakeEnvelope(
                        ${-m + (x * r)},
                        ${ m - (y * r)},
                        ${-m + (x * r) + r},
                        ${ m - (y * r) - r},
                        3857
                    ),
                    4096,
                    256,
                    true) geom
            FROM ${table}
            WHERE ST_DWithin(ST_MakeEnvelope(
                ${-m + (x * r)},
                ${ m - (y * r)},
                ${-m + (x * r) + r},
                ${ m - (y * r) - r},
                3857
            ),${req.query.geom_3857},0)
        ) tile
        ${tilecache ? 'RETURNING mvt;' : ';'}
        `;

    var db_connection = await fastify.pg[req.query.dbs].connect();
    var result = await db_connection.query(q);
    db_connection.release();

    res
        .type('application/x-protobuf')
        .code(200)
        .send(result.rows[0].mvt);
}