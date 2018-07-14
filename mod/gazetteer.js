module.exports = { autocomplete, googleplaces }

async function autocomplete(req, res, fastify) {

    let user = fastify.jwt.decode(req.cookies.xyz_user),
        locale = global.workspace[user.access].config.locales[req.query.locale];

    if (!locale.gazetteer) return res.code(406).send('Parameter not acceptable.');

    //if (locale.gazetteer.datasets) placesAutoComplete(req, res, locale, fastify);

    eval(locale.gazetteer.provider + '_placesAutoComplete')(req, res, locale.gazetteer);
}

async function placesAutoComplete(req, res, locale, fastify) {

    let result;
    for (let dataset of locale.gazetteer.datasets){

        var q = `
        SELECT
            ${dataset.label} AS label,
            ${locale.layers[dataset.layer].qID || 'id'} AS id
            FROM ${dataset.table}
            WHERE ${dataset.label} ILIKE '${decodeURIComponent(req.query.q)}%'
            LIMIT 10`;

        // ORDER BY searchindex, search
     
        var db_connection = await fastify.pg[locale.layers[dataset.layer].dbs].connect();
        result = await db_connection.query(q);
        db_connection.release();

        if (result.rows.length > 0) break;

    }

    let foo = Object.values(result.rows).map(row => {
        return {
            label: row.label,
            id: row.id,
            source: 'glx'
        }
    });

    res.code(200).send(foo);

    // res.code(200).send(JSON.parse(body).features.map(f => {
    //     return {
    //         label: `${f.text} (${f.place_type[0]}) ${!gazetteer.code && f.context ? ', ' + f.context.slice(-1)[0].text : ''}`,
    //         id: f.center,
    //         source: 'mapbox'
    //     }
    // }))

    //return result;
}

function MAPBOX_placesAutoComplete(req, res, gazetteer) {
    var q = `https://api.mapbox.com/geocoding/v5/mapbox.places/${req.query.q}.json?`
          + `${gazetteer.code ? 'locale=' + gazetteer.code : ''}`
          + `${gazetteer.bounds ? 'bbox=' + gazetteer.bounds : ''}`
          + `&types=postcode,district,locality,place,neighborhood,address,poi`
          + `&${global.KEYS[gazetteer.provider]}`;

    require('request').get(q, (err, response, body) => {
        if (err) {
            console.error(err);
            return
        }

        res.code(200).send(JSON.parse(body).features.map(f => {
            return {
                label: `${f.text} (${f.place_type[0]}) ${!gazetteer.code && f.context ? ', ' + f.context.slice(-1)[0].text : ''}`,
                id: f.center,
                source: 'mapbox'
            }
        }))
    })
}

function GOOGLE_placesAutoComplete(req, res, gazetteer) {
    var q = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${req.query.q}`
          + `${gazetteer.code ? '&components=country:' + gazetteer.code : ''}`
          + `${gazetteer.bounds ? decodeURIComponent(gazetteer.bounds) : ''}`
          + `&${global.KEYS[gazetteer.provider]}`;

    require('request').get(q, (err, response, body) => {
        if (err) {
            console.error(err);
            return
        }

        res.code(200).send(JSON.parse(body).predictions.map(f => {
            return {
                label: f.description,
                id: f.place_id,
                source: 'google'
            }
        }))
    })
}

function googleplaces(req, res) {
    var q = `https://maps.googleapis.com/maps/api/place/details/json?placeid=${req.query.id}`
          + `&${global.KEYS.GOOGLE}`;

    require('request').get(q, (err, response, body) => {
        if (err) {
            console.error(err);
            return
        }

        let r = JSON.parse(body).result;
        res.code(200).send({
            type: 'Point',
            coordinates: [r.geometry.location.lng, r.geometry.location.lat]
        })
    })
}