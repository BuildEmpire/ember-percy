import Ember from 'ember';

function getDoctype() {
  let doctypeNode = document.doctype;
  if (!doctypeNode || !doctypeNode.name) {
    return '<!DOCTYPE html>';
  }
  let doctype = "<!DOCTYPE " +
    doctypeNode.name +
    (doctypeNode.publicId ? ' PUBLIC "' + doctypeNode.publicId + '"' : '') +
    (!doctypeNode.publicId && doctypeNode.systemId ? ' SYSTEM' : '') +
    (doctypeNode.systemId ? ' "' + doctypeNode.systemId + '"' : '') +
    '>';
  return doctype;
}

// jQuery Mockjax-specific handling to workaround blocking of HTTP requests if users have
// set the throwUnmocked setting.
function maybeDisableMockjax() {
  if (jQuery && jQuery.mockjaxSettings && jQuery.mockjaxSettings.throwUnmocked) {
    jQuery.mockjaxSettings._originalThrowUnmocked = jQuery.mockjaxSettings.throwUnmocked;
    jQuery.mockjaxSettings.throwUnmocked = false;
  }
}
function maybeResetMockjax() {
  if (jQuery && jQuery.mockjaxSettings && jQuery.mockjaxSettings._originalThrowUnmocked) {
     jQuery.mockjaxSettings.throwUnmocked = jQuery.mockjaxSettings._originalThrowUnmocked;
  }
}

// Percy finalizer to be called at the very end of the test suite.
function finalizeBuildOnce() {
  // Use "async: false" to block the browser from shutting down until the finalize_build call
  // has fully returned. This prevents testem from shutting down the express server until
  // our middleware has finished uploading resources and resolving promises.
  maybeDisableMockjax();
  Ember.$.ajax('/_percy/finalize_build', {method: 'POST', async: false, timeout: 30000});
  maybeResetMockjax();
}

let hasRegisteredFinalizer = false;
export function percySnapshot(name, options) {
  // Skip if Testem is not available (we're probably running from `ember server` and Percy is not
  // enabled anyway).
  if (!window.Testem) {
    return;
  }

  let snapshotHtml;
  options = options || {};
  let scope = options.scope;

  // On the first call to percySnapshot, register a Testem hook to know when all tests are finished.
  if (!hasRegisteredFinalizer) {
    hasRegisteredFinalizer = true;
    if (window.Testem.afterTests) {
      // Testem >= v1.6.0. (We should just use afterTests, but it does not work as expected).
      window.Testem.on('after-tests-complete', finalizeBuildOnce);
    } else {
      // Testem < v1.6.0.
      window.Testem.on('all-test-results', finalizeBuildOnce);
    }
  }

  // Create a full-page DOM snapshot from the current testing page.
  // TODO(fotinakis): more memory-efficient way to do this?
  let domCopy = Ember.$('html').clone();
  let testingContainer = domCopy.find('#ember-testing-container');

  if (scope) {
    snapshotHtml = Ember.$('#ember-testing-container').find(scope).html();
  } else {
    snapshotHtml = testingContainer.html();
  }

  // Hoist the testing container contents up to the body.
  // We need to use the original DOM to keep the head stylesheet around.
  domCopy.find('body').html(snapshotHtml);

  Ember.run(function() {
    maybeDisableMockjax();
    Ember.$.ajax('/_percy/snapshot', {
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify({
        name: name,
        content: getDoctype() + domCopy[0].outerHTML,
        widths: options.widths,
        breakpoints: options.breakpoints,
      }),
      statusCode: {
        400: function(jqXHR) {
          // Bubble up 400 errors, ie. when given options are invalid.
          throw jqXHR.responseText;
        },
      }
    });
    maybeResetMockjax();
  });
}
