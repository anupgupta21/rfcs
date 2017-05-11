'use strict'

const fs = require('fs')
const ejs = require('ejs')
const glob = require('glob')
const path = require('path')
const exec = require('child_process').execSync
const marked = require('marked')
const cheerio = require('cheerio')
const findVersions = require('find-versions')
const reportBuilder = require('junit-report-builder')

// We need a custom renderer to make sure we generate the same header IDs as
// Github.
const renderer = new marked.Renderer()
renderer.heading = function (text, level, raw) {
  const candidateId = raw
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/ /g, '-')

  return '<h'
    + level
    + ' id="'
    + this.options.headerPrefix
    + candidateId
    + '">'
    + text
    + '</h'
    + level
    + '>\n';
}

// Override relative links from .md files to the base folder
// (Allows github to be linked properly, and website as well)
renderer.link = function (href, title, text) {
  // Converts something like `../xxxx-<anything>/xxxx-<anything>.md` to `../xxxx-<anything>`
  href = href.replace(/^(\.{2}\/\d{4}-.*)\/(\d{4}-.*\.md)$/g, '$1')
  return marked.Renderer.prototype.link.call(this, href, title, text);
};

const testReportBuilder = reportBuilder.newBuilder()

let cwd = path.resolve(__dirname, '..')
exec('rm -rf web', { cwd })
exec('git clone git@github.com:interledger/rfcs.git --branch gh-pages --single-branch web', { cwd })
exec('cp -r ????-* web', { cwd })
exec('cp -r shared web', { cwd })

const template = ejs.compile(fs.readFileSync('tmpl/rfc.ejs.html', 'utf8'))
const files = glob.sync('????-*/????-*.md')
let buildPass = true

files.forEach((file) => {

  const testCase = testReportBuilder.testCase().className(file).name('')

  try {

    const markdownContent = fs.readFileSync(file, 'utf8')
    const renderedMarkdown = marked(markdownContent, { renderer })
    const $ = cheerio.load(renderedMarkdown)
    const title = $('h1').text()
    testCase.name('Generate ' + title)

    if(title == "") {
        testCase.skipped('No title. Assuming this RFC number is not being used.')
        return
    }

    //Get Version
    const version = findVersions(title, { loose: true })[0]

    // Ensure heading IDs are unique
    const idMap = new Map()
    const headings = $('h1,h2,h3,h4,h5,h6').each(function () {
      const tag = $(this)
      const id = tag.attr('id')
      let tags = idMap.get(id)
      if (!tags) {
        tags = []
        idMap.set(id, tags)
      }
      tags.push(tag)
    })

    for (let group of idMap) {
      if (group[1].length > 1) {
        group[1].forEach((tag, i) => {
          tag.attr('id', tag.attr('id') + '-' + (i + 1))
        })
      }
    }

    // Generate navigation
    const toc = $('h2, h3').map(function () {
      const tag = $(this)
      return {
        type: tag.get(0).tagName,
        title: tag.text(),
        anchor: tag.attr('id')
      }
    }).get()

    $('table').addClass('table').addClass('table-striped')

    $('p').first().addClass('intro')

    $('img').addClass('img-responsive')

    const content = $.html()

    const renderedHtml = template({ title, content, toc })

    //Versioning
    if (version) {
      const versionFile = 'web/' + path.dirname(file) + '/v' + version + '.html'
      if (fs.existsSync(versionFile)) {
        const existingHtml = fs.readFileSync(versionFile, 'utf8')
        if (existingHtml != renderedHtml) {
          testCase.failure('This version of the spec already exists, please update the version number.')
          buildPass = false
          return
        }
        testCase.skipped('No changes')
        return
      }
      fs.writeFileSync(versionFile, renderedHtml)
    } else {
          testCase.error('No version number found in title.')
          buildPass = false
          return
    }

    fs.writeFileSync('web/' + path.dirname(file) + '/index.html', renderedHtml)

  } catch (err) {
    testCase.stacktrace(err.stack)
  }
})
testReportBuilder.writeTo(path.resolve(__dirname, '../reports/generate_web.js.' + Date.now() + '.xml') + '')

cwd = path.resolve(__dirname, '../web')
const status = exec('git status --porcelain', { cwd }).toString('utf8')
if (!status.length) {
  console.log('no changes')
} else {
  console.log(status)
}

process.exit(buildPass ? 0 : 1)