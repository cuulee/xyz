const d3 = require('d3');
const utils = require('./utils');

function bar_chart(layer, chart){
    /*let data = [ // some test data
        {"hour": 0, "count": 12},
        {"hour": 1, "count": 2},
        {"hour": 2, "count": 1},
        {"hour": 3, "count": 7},
        {"hour": 4, "count": 7},
        {"hour": 5, "count": null},
        {"hour": 6, "count": 19},
        {"hour": 7, "count": 25},
        {"hour": 8, "count": 100},
        {"hour": 9, "count": 153}
    ];*/
    //let data = layer.charts[chart];
    let data = _xyz.locales[_xyz.locale].layers[layer].charts[chart];
    console.log(data);
    
    let div = utils.createElement('div');
    let td = utils.createElement('td', {
        colSpan: "2"
    });
    let tr = utils.createElement('tr');
    
    // set the dimensions of the canvas
    let margin = {top: 20, right: 10, bottom: 20, left: 30},
        width = 290 - margin.left - margin.right,
        height = 200 - margin.top - margin.bottom;
    
    // set the ranges
    let x = d3.scaleBand().range([0, width]).round(0.05);
    let y = d3.scaleLinear().range([height, 0]);
    
    // define the axis
    let xAxis = d3.axisBottom(x);
    let yAxis = d3.axisLeft().scale(y);
    
    function get_labels(){
        let _labels = [];
        function sort_by_x(){
            return function (x, y) {
                return ((x.x === y.x) ? 0 : ((x.x > y.x) ? 1 : -1));
            };
        }
        for(let item of data.sort(sort_by_x)){
            _labels.push(item.label);
        }
        return _labels;
    }
    
    // add the SVG element
    //let svg = d3.select("body").append("svg")
    let svg = d3.select(div).append('svg')
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
    
    // scale the range of the data
    x.domain(data.map(function(d){
        return d.x;
    }));
    y.domain([0, d3.max(data, function(d){
        return d.y ? d.y : 0; 
    })]);
    
    // append the rectangles for the bar chart d3 v4
    svg.selectAll(".bar")
        .data(data)
        .enter()
        .append("rect")
        .attr("class", "bar")
        .attr("x", function(d){
            return x(d.x);
        })
        .attr("width", x.bandwidth())
        .attr("y", function(d){
            return y(d.y);
        })
        .attr("height", function(d){ 
            return height - y(d.y);
        });
    
      // add the x Axis
    svg.append("g")
      .attr("transform", "translate(0," + height + ")")
      .call(d3.axisBottom(x).tickValues(get_labels()));
    
    
       // text label for the x axis
    svg.append("text")             
      .attr("transform", "translate(" + (width/2) + " ," + (height + margin.top + 20) + ")")
      .style("text-anchor", "middle");
    
      // add the y Axis
    svg.append("g").call(d3.axisLeft(y));
    
     // text label for the y axis
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left)
      .attr("x",0 - (height / 2))
      .attr("dy", "1em")
      .style("text-anchor", "middle");
    
    td.appendChild(div);
    tr.appendChild(td);
    console.log(tr);
    return tr;
}

module.exports = {
    bar_chart: bar_chart
}