//Libraries
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const mysql = require('mysql2');
const Anthropic = require('@anthropic-ai/sdk');
const { check, validationResult } = require('express-validator');
const path = require('path');

//Setup defaults for script
const app = express();
app.use(express.static('public'));
//Stylesheet
app.use(express.static(__dirname + '/public'));

//Webpage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const upload = multer();
const port = 3000;




//Database connection
const connection = mysql.createConnection({
    host: "student-databases.cvode4s4cwrc.us-west-2.rds.amazonaws.com",
    user: "ZACKLAKE",
password: process.env.DB_PASSWORD,
    database: 'ZACKLAKE'
});

//Creates connection to Claude AI using API key
const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

//Validation rules for the estimate form
const projectNameValidation = check('project_name', 'Project name is required.')
    .notEmpty();

const projectTypeValidation = check('project_type', 'Please select a valid project type.')
    .notEmpty()
    .bail()
    .isIn(['Residential Home', 'Commercial Building', 'Garage', 'Warehouse', 'Shed', 'Addition', 'Renovation']);

const locationValidation = check('location', 'Location is required.')
    .trim()
    .notEmpty();

const lengthValidation = check('length', 'Length must be a positive number.')
    .notEmpty()
    .bail()
    .isFloat({ gt: 0 });

const widthValidation = check('width', 'Width must be a positive number.')
    .notEmpty()
    .bail()
    .isFloat({ gt: 0 });

const heightValidation = check('height', 'Height must be a positive number.')
    .notEmpty()
    .bail()
    .isFloat({ gt: 0 });

const materialsValidation = check('materials', 'Please select a valid material.')
    .notEmpty()
    .bail()
    .isIn(['wood', 'steel', 'concrete', 'brick']);

const loadTypeValidation = check('load_type', 'Please select a valid load type.')
    .notEmpty()
    .bail()
    .isIn(['static', 'dynamic']);

const costPerUnitValidation = check('cost_per_unit', 'Cost per unit must be a positive number.')
    .notEmpty()
    .bail()
    .isFloat({ gt: 0 });

//GET route - returns all estimates with project info from database
app.get(
    '/estimates/',
    upload.none(),
    (request, response) => {
        let selectSql = `SELECT 
            e.id,
            e.length,
            e.width,
            e.height,
            e.materials,
            e.load_type,
            e.cost_per_unit,
            e.created_at,
            e.results,
            p.project_name,
            p.project_type,
            p.location
            FROM estimates e
            INNER JOIN projects p ON e.project_id = p.id`,
        whereStatements = [],
        orderByStatements = [],
        queryParameters = [];

        if (typeof request.query.project_name !== 'undefined' && request.query.project_name.length > 0) {
            whereStatements.push('p.project_name LIKE ?');
            queryParameters.push('%' + request.query.project_name + '%');
        }

        if (typeof request.query.project_type !== 'undefined' && request.query.project_type.length > 0) {
            whereStatements.push('p.project_type = ?');
            queryParameters.push(request.query.project_type);
        }

        if (typeof request.query.location !== 'undefined' && request.query.location.length > 0) {
            whereStatements.push('p.location LIKE ?');
            queryParameters.push('%' + request.query.location + '%');
        }

        if (typeof request.query.sort !== 'undefined' && request.query.sort.length > 0) {
            orderByStatements.push('e.created_at ' + request.query.sort);
        }

        if (whereStatements.length > 0) {
            selectSql = selectSql + ' WHERE ' + whereStatements.join(' AND ');
        }

        if (orderByStatements.length > 0) {
            selectSql = selectSql + ' ORDER BY ' + orderByStatements.join(', ');
        }

        if (typeof request.query.limit !== 'undefined' && request.query.limit > 0 && request.query.limit < 6) {
            selectSql = selectSql + ' LIMIT ' + request.query.limit;
        }

        connection.query(selectSql, queryParameters, (error, result) => {
            if (error) {
                console.log(error);
                return response
                    .status(500)
                    .json({ message: 'Something went wrong with the server.' });
            }
            response.json({ 'data': result });
        });
    }
);

//GET route - returns a single estimate by ID
app.get(
    '/estimates/:id/',
    upload.none(),
    (request, response) => {
        const selectSql = `SELECT 
            e.id,
            e.length,
            e.width,
            e.height,
            e.materials,
            e.load_type,
            e.cost_per_unit,
            e.results,
            p.project_name,
            p.project_type,
            p.location
            FROM estimates e
            INNER JOIN projects p ON e.project_id = p.id
            WHERE e.id = ?`;

        connection.query(selectSql, [request.params.id], (error, result) => {
            if (error) {
                console.log(error);
                return response
                    .status(500)
                    .json({ message: 'Something went wrong with the server.' });
            }
            response.json({ 'data': result });
        });
    }
);

//POST route - validates form, calls Claude AI, saves to both tables
app.post(
    '/estimates/',
    upload.none(),
    [
        projectNameValidation,
        projectTypeValidation,
        locationValidation,
        lengthValidation,
        widthValidation,
        heightValidation,
        materialsValidation,
        loadTypeValidation,
        costPerUnitValidation
    ],
    (request, response) => {
        //Validate request; If there any errors, send 400 response back
        const errors = validationResult(request);
        if (!errors.isEmpty()) {
            return response
                .status(400)
                .json({
                    message: 'Request fields or files are invalid.',
                    errors: errors.array(),
                });
        }

        //Call Claude AI then save to database
        client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            system: "You are a professional construction estimator. Provide detailed, accurate, well-formatted estimates with realistic current market pricing.",
            messages: [{
                role: "user", content: `You are an expert construction estimator with 20+ years of experience.
Generate a detailed professional construction estimate for the following project:

- Dimensions: ${request.body.length} ft long x ${request.body.width} ft wide x ${request.body.height} ft tall
- Total Square Footage: ${(parseFloat(request.body.length) * parseFloat(request.body.width)).toFixed(0)} sq ft
- Primary Material: ${request.body.materials}
- Load Type: ${request.body.load_type}
- Material Cost per Unit: $${request.body.cost_per_unit}

Please provide:
1. MATERIAL BREAKDOWN - all materials with quantities and costs
2. LABOR COSTS - by trade with estimated hours
3. COST SUMMARY - materials, labor, overhead, contingency, and TOTAL
4. PROJECT TIMELINE - estimated weeks and key phases
5. RECOMMENDATIONS - structural notes and cost-saving tips

Format as a clear professional contractor estimate with realistic current market pricing.` }]
        }).then((claudeResponse) => {
            const estimateText = claudeResponse.content[0].text;

            //Save to projects table first
            const projectSql = `INSERT INTO projects (project_name, project_type, location) VALUES (?, ?, ?)`;
            let projectParameters = [
                request.body.project_name,
                request.body.project_type,
                request.body.location
            ];

            connection.query(projectSql, projectParameters, (error, projectResult) => {
                if (error) {
                    console.log(error);
                    return response
                        .status(500)
                        .json({ message: 'Something went wrong saving project.' });
                }

                //Save to estimates table using new project id
                const estimateSql = `INSERT INTO estimates (project_id, length, width, height, materials, load_type, cost_per_unit, results) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
                let estimateParameters = [
                    projectResult.insertId,
                    request.body.length,
                    request.body.width,
                    request.body.height,
                    request.body.materials,
                    request.body.load_type,
                    request.body.cost_per_unit,
                    estimateText
                ];

                connection.query(estimateSql, estimateParameters, (error, result) => {
                    if (error) {
                        console.log(error);
                        return response
                            .status(500)
                            .json({ message: 'Something went wrong saving estimate.' });
                    }
                    response.json({ 'data': 'Estimate generated and saved successfully!' });
                });
            });
        }).catch((error) => {
            console.log(error);
            return response
                .status(500)
                .json({ message: 'Something went wrong with the AI service.' });
        });
    }
);

//PUT route - updates an existing estimate by ID
app.put(
    '/estimates/:id/',
    upload.none(),
    [
        projectNameValidation,
        projectTypeValidation,
        locationValidation,
        lengthValidation,
        widthValidation,
        heightValidation,
        materialsValidation,
        loadTypeValidation,
        costPerUnitValidation
    ],
    (request, response) => {
        //Validate request; If there any errors, send 400 response back
        const errors = validationResult(request);
        if (!errors.isEmpty()) {
            return response
                .status(400)
                .json({
                    message: 'Request fields or files are invalid.',
                    errors: errors.array(),
                });
        }

        //Update the projects table first
        const projectSql = `UPDATE projects p 
            INNER JOIN estimates e ON e.project_id = p.id
            SET p.project_name = ?, p.project_type = ?, p.location = ?
            WHERE e.id = ?`;
        let projectParameters = [
            request.body.project_name,
            request.body.project_type,
            request.body.location,
            request.params.id
        ];

        connection.query(projectSql, projectParameters, (error, projectResult) => {
            if (error) {
                console.log(error);
                return response
                    .status(500)
                    .json({ message: 'Something went wrong updating project.' });
            }

            //Update the estimates table
            const estimateSql = `UPDATE estimates 
                SET length = ?, width = ?, height = ?, materials = ?, load_type = ?, cost_per_unit = ?
                WHERE id = ?`;
            let estimateParameters = [
                request.body.length,
                request.body.width,
                request.body.height,
                request.body.materials,
                request.body.load_type,
                request.body.cost_per_unit,
                request.params.id
            ];

            connection.query(estimateSql, estimateParameters, (error, result) => {
                if (error) {
                    console.log(error);
                    return response
                        .status(500)
                        .json({ message: 'Something went wrong updating estimate.' });
                }
                response.json({ 'data': 'Estimate updated successfully!' });
            });
        });
    }
);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});