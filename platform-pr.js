'use strict';
define(['jquery-deparam', 'jquery-postmessage'], function () {

function isCrossDomain() {
   function isInIframe() {
      try {
         return window.self !== window.top;
      } catch (e) {
         return false;
      }
   }
   function isSameDomain() {
      var res = false;
      try{
          parent.document;
          res = true;
      } catch(e){
      }
      return res;
   }
   return isInIframe && !isSameDomain();
}

if ( ! isCrossDomain()) {

   /* Implementation of a platform proxy for the task iframe. This object is always
    * available, but is effective only when setPlatform is called with a true
    * platform object.
    */

   return {
      registered_objects : [],
      parent_platform : null,
      setPlatform: function(platformArg) {
         platform.parent_platform = platformArg;
      },
      trigger: function(event, content) {
         $.each(this.registered_objects, function(i, object){
            if (typeof(object[event]) != "undefined") {
               object[event].apply(this, content);
            }
         });
      },
      subscribe: function(object) {
         this.registered_objects.push(object);
      },
      unsubscribe: function(object) {
         var index = this.registered_objects.indexOf(object);
         if (index != -1) {
            this.registered_objects.splice(index, 1);
         }
      },
      validate: function(mode) {
         var res = platform.parent_platform.validate(mode);
         this.trigger('validate', [mode]);
         return res;
      },
      showView: function(views) {
         return platform.parent_platform.showView(views);
      },
      askHint: function(platformToken) {
         return platform.parent_platform.askHint(platformToken);
      },
      updateHeight: function(height) {
         return platform.parent_platform.updateHeight(height);
      },
      getTaskParams: function(key, defaultValue) {
         return platform.parent_platform.getTaskParams(key, defaultValue);
      }
   };

}

   /*
    * Platform proxy implementation for Bebras task API - v1.0 - 08/2014
    *
    * This file is the file to include for a task to be sure to have a platform
    * object proxy, when platform and task are on different domain. It also
    * works on the same domain, but is less efficient than the same-domain
    * equivalent.
    *
    * This file implements a postMessage listener so that calls coming from
    * task-proxy-xd.js land on the task object.
    *
    */


   /**
    * Enable / Disable messages debug
    */
   var taskDebug = true;

   var sPlatform = null;
   var sToken = null;

   /**
    * A message can be sent or retrieved
    *
    * @param {string} request
    * @param {string} content
    * @param {string} iframe source id
    * @param {string} message identifier
    * @returns {Message}
    */
   var Message = function(request, content, sSourceId, messageId, proxyId)
   {
      this.request = request;
      this.content = content;
      this.source = sSourceId;
      this.messageId = messageId;
      this.proxyId = proxyId;
   };

   /**
    * Postmessage interface for tasks
    */
   var PmInterface = {
      /**
       * Request to response map
       * @type object
       */
      responseFromRequest: {
         getHeight: 'getHeightCallback',
         getViews: 'getViewsCallback',
         showViews: 'showViewsCallback',
         getAnswer: 'getAnswerCallback',
         getState: 'getStateCallback',
         getMetaData: 'getMetaDataCallback',
         setId: 'setIdCallback',
         updateToken: 'updateTokenCallback',
         reloadAnswer: 'reloadAnswerCallback',
         reloadState: 'reloadStateCallback',
         load: 'loadCallback',
         unload: 'unloadCallback',
         getTaskResources: 'getTaskResourcesCallback',
         generateTask: 'generateTaskCallback',
         'grader.gradeTask': 'grader.gradeTaskCallback'
      },

      specialRequests: {
         getTaskResources: '',
         generateTask: '',
         gradeTask: ''
      },

      mustWaitFor: {
         //getAnswer: 'submissionsAvailable',
         //getAnswerHtml: 'submissionsAvailable'
      },

      parent_url: null,
      sSourceId: null,
      sTypeId: null,

      listeners: {},
      callbacks: {},

      init: function(parent_url) {
         PmInterface.parent_url = parent_url;
         $.receiveMessage(PmInterface.messageCallback, PmInterface.allowSourceOrigin);
      },

      /**
      * New message !
      *
      * @param {type} e
      */
      messageCallback: function(e) {
         var message = PmInterface.getMessage(e.data);
         if (taskDebug) {
            console.log('Task '+PmInterface.sSourceId+' Got: ');
            console.log(message);
         }
         if (message.request === 'setId') {
            PmInterface.sSourceId = message.content[0];
            PmInterface.sSourceProxyId = message.content[1];
            PmInterface.respond(message, null);
            return;
         } else if (PmInterface.sSourceId === null) {
            console.warn("task received message while ID was not set!");
            return;
         }
         if (message.proxyId != PmInterface.sSourceProxyId) {
            console.warn("task received message from wrong proxy");
            return;
         }
         // If a callback was used, call it
         if (message.messageId in PmInterface.callbacks) {
            PmInterface.callbacks[message.messageId].apply(this, message.content);
            delete PmInterface.callbacks[message.messageId];
            return;
         }
         var object = task;
         var functionName = message.request;
         if (message.request.lastIndexOf('grader.', 0) === 0) {
            object = grader;
            functionName = functionName.substring(7);
         }
         if (typeof object[functionName] === 'function' || message.request in PmInterface.specialRequests) {
            /**
             * If the current request required waiting
             */
            if (message.request in PmInterface.mustWaitFor && !window[PmInterface.mustWaitFor[message.request]]) {
               setTimeout(function() {
                  PmInterface.messageCallback(e);
               }, 250);

               return;
            }
            else {
               if (typeof message.content === 'string') {
                  if (message.content !== '' && message.content != 'null') {
                     message.content = [message.content];
                  }
                  else {
                     // No parameter
                     message.content = [];
                  }
               }
               // When a callback is used
               if (PmInterface.responseFromRequest[message.request] == message.request+'Callback') {
                  if (message.request === 'load') {
                     // here we've hacked load to get taskParams as parameter
                     // 3. see task-proxy-xd.js.
                     platform.setTaskParams(message.content[1]);
                     message.content = message.content.splice(0,1);
                  }
                  // adding a callback proxy
                  message.content.push(function() {
                     // Convert arguments to an array (arguments is not an array)
                     var parameters = [];
                     for(var i = 0; i < arguments.length; i++) {
                        parameters.push(arguments[i]);
                     }
                     PmInterface.respond(message, parameters);
                  });
                  if (typeof object[functionName] === 'function') {
                     object[functionName].apply(object, message.content);
                     var functionsToTrigger = ['load', 'unload', 'reloadAnswer', 'showViews', 'reloadState'];
                     if (functionsToTrigger.indexOf(message.request) > -1) {
                        platform.trigger(message.request, message.content);
                     }
                  }
                  else {
                     // TODO: handle error
                     console.error('erreur 1 !');
                  }
               }
               else {
                  var answer = null;
                  if (typeof object[functionName] === 'function') {
                     answer = object[functionName].apply(object, message.content);
                  }
                  else {
                     // TODO: handle error
                     console.error('erreur 2 !');
                  }
                  PmInterface.respond(message, answer);
               }
            }
         }
         else {
            console.warn('Warning : Task '+PmInterface.sSourceId+' got undefined '+message.request);
         }
      },

      /**
       * Respond to the message (called by the "callback proxy")
       *
       * @param {Message} message
       * @param {string} answer
       */
      respond: function(message, answer) {
         if (message.request in PmInterface.responseFromRequest) {
            var msg = new Message(PmInterface.responseFromRequest[message.request], answer, PmInterface.sSourceId, message.messageId);
            $.postMessage(msg, PmInterface.parent_url, parent);
            if (taskDebug && msg.request !== 'getHeightCallback') {
               console.log('Task '+PmInterface.sSourceId+' Sends: ');
               console.log(msg);
            }
         }
      },

      /**
       * Send a message to platform's frame
       *
       * @param {object} task
       * @param {object} request
       * @param {array} content
       * @param {function} callback
       */
      sendMessage: function(request, content, callback) {
         var messageId = PmInterface.getRandomID();
         // Register callback
         if (typeof callback != 'undefined') {
            PmInterface.callbacks[messageId] = callback;
         }
         var msg = new Message(request, content, PmInterface.sSourceId, messageId);
         if (taskDebug) {
            console.log('Task '+PmInterface.sSourceId+' Sends: ');
            console.log(msg);
         }
         $.postMessage(msg, PmInterface.parent_url, parent);
      },

      /**
       * Generates a random id
       *
       * @returns {integer}
       */
      getRandomID: function() {
         var low = Math.floor(Math.random() * 922337203).toString();
         var high = Math.floor(Math.random() * 2000000000).toString();
         return high + low;
      },

      /**
       * Check if we allow the origin's message
       *
       * @param {type} origin
       * @returns {Boolean}
       */
      allowSourceOrigin: function(origin) {
         return true;
      },

      /**
       * Retrieve a Message object from a $.receiveMessage call
       *
       * @param {string} serializedString
       * @returns {Message}
       */
      getMessage: function(serializedString) {
         var obj = $.deparam(serializedString, true);
         var message = null;

         if (obj.request) {
            message = new Message(obj.request, obj.content, obj.source, obj.messageId, obj.proxyId);
         }

         return message;
      }
   };

   /**
    * Platform interface as if it is direclty available
    */
   return {
      registered_objects : [],
      taskParams : null,
      trigger: function(event, content) {
         $.each(this.registered_objects, function(i, object){
            object[event].apply(this, content);
         });
      },
      subscribe: function(object) {
         this.registered_objects.push(object);
      },
      unsubscribe: function(object) {
         var index = this.registered_objects.indexOf(object);
         if (index != -1) {
            this.registered_objects.splice(index, 1);
         }
      },
      setTaskParams: function(taskParams) {
         this.taskParams = taskParams;
      },
      validate: function(mode) {
         PmInterface.sendMessage('validate', [mode]);
         this.trigger('validate');
      },
      updateHeight: function(height) {
         PmInterface.sendMessage('updateHeight', [height]);
      },
      askHint: function(platformToken) {
         PmInterface.sendMessage('askHint', [platformToken]);
      },
      showView: function(views) {
         PmInterface.sendMessage('showView', [views]);
      },
      getTaskParams: function(key, defaultValue) {
         if (typeof key !== 'undefined') {
            if (key !== 'options' && key in this.taskParams) {
               return this.taskParams[key];
            } else if (this.taskParams.options && key in this.taskParams.options) {
               return this.taskParams.options[key];
            }
            return (typeof defaultValue !== 'undefined') ? defaultValue : null;
         }
         return this.taskParams;
      },
      openUrl: function(url) {
         PmInterface.sendMessage('openUrl', [url]);
      }
   };

});